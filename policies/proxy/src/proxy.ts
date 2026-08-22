import type {
  Application,
  ContextMeta,
  FrameworkMeta,
  Request,
  Response,
} from "filamentjs";
import type {
  ProxyRoute,
  SetupOptions,
  SetupResult,
  Upstream,
} from "./types.js";

const installed = new WeakSet<object>();
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const NEVER_FORWARD_REQUEST = new Set([
  ...HOP_BY_HOP,
  "host",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "content-length",
]);
const DEFAULT_REQUEST = [
  "accept",
  "accept-language",
  "content-type",
  "user-agent",
];
const DEFAULT_RESPONSE = [
  "cache-control",
  "content-language",
  "content-type",
  "etag",
  "expires",
  "last-modified",
  "vary",
  "www-authenticate",
];

function positiveInteger(
  value: number,
  label: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new RangeError(
      `${label} must be a positive integer no greater than ${maximum}`,
    );
  return value;
}
function headerNames(values: readonly string[], response = false): string[] {
  const result = values.map((value) => value.toLowerCase());
  if (
    result.some(
      (value) =>
        !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(value) ||
        HOP_BY_HOP.has(value) ||
        (!response && NEVER_FORWARD_REQUEST.has(value)),
    )
  )
    throw new TypeError("header allowlist contains a forbidden header");
  return [...new Set(result)];
}
function trustedUpstream(value: Upstream): {
  origin: URL;
  basePath: string;
  headers: Headers;
} {
  const url = new URL(value.origin);
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new TypeError(
      "upstream origin must be a credential-free HTTP(S) origin",
    );
  const basePath = value.basePath ?? "";
  if (
    basePath !== "" &&
    (!basePath.startsWith("/") ||
      basePath.includes("?") ||
      basePath.includes("#") ||
      basePath.split("/").some((part) => part === "." || part === ".."))
  )
    throw new TypeError("upstream basePath is unsafe");
  const headers = new Headers(value.headers);
  for (const name of headers.keys())
    if (NEVER_FORWARD_REQUEST.has(name.toLowerCase()))
      throw new TypeError("upstream headers contain a forbidden header");
  return { origin: url, basePath: basePath.replace(/\/$/, ""), headers };
}
function validateTemplate(template: string): void {
  if (
    !template.startsWith("/") ||
    template.startsWith("//") ||
    template.includes("?") ||
    template.includes("#") ||
    template.includes("\\")
  )
    throw new TypeError("upstreamPath must be an absolute path template");
  if (template.split("/").some((part) => part === "." || part === ".."))
    throw new TypeError("upstreamPath contains traversal");
}
function rewrite(template: string, req: Request): string {
  validateTemplate(template);
  const result = template.replace(
    /:([A-Za-z_][A-Za-z0-9_]*)/g,
    (_all, name: string) => {
      const value = req.params[name];
      if (value === undefined)
        throw new Error(`Missing route parameter ${name}`);
      return encodeURIComponent(value);
    },
  );
  if (result.split("/").some((part) => part === "." || part === ".."))
    throw new TypeError("rewritten path contains traversal");
  return result;
}
function query(req: Request): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(req.query))
    for (const item of Array.isArray(value) ? value : [value])
      params.append(name, item);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}
function requestHeaders(
  req: Request,
  allowed: readonly string[],
  fixed: Headers,
): Headers {
  const result = new Headers(fixed);
  for (const name of allowed) {
    const value = req.headers.get(name);
    if (Array.isArray(value))
      for (const item of value) result.append(name, item);
    else if (value !== null) result.set(name, value);
  }
  return result;
}
async function boundedBody(
  response: globalThis.Response,
  maximum: number,
  abort: AbortController,
): Promise<Buffer> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > maximum)
  )
    throw new RangeError("upstream response exceeds maxResponseBytes");
  if (response.body === null) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > maximum) {
      abort.abort();
      throw new RangeError("upstream response exceeds maxResponseBytes");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}
function retryable(method: string, status?: number): boolean {
  return (
    (method === "GET" || method === "HEAD") &&
    (status === undefined || status === 502 || status === 503 || status === 504)
  );
}

export function setup<A extends FrameworkMeta, C extends ContextMeta>(
  app: Application<A, C>,
  options: SetupOptions<A>,
): SetupResult {
  if (installed.has(app))
    throw new Error("proxy is already installed on this application");
  if (options.routes.length === 0)
    throw new TypeError("at least one proxy route is required");
  const upstreams = new Map(
    Object.entries(options.upstreams).map(([name, value]) => [
      name,
      trustedUpstream(value),
    ]),
  );
  const seen = new Set<string>();
  const registrations: Array<{
    route: ProxyRoute<A>;
    handler: (req: Request<A, C>, res: Response) => Promise<void>;
  }> = [];
  for (const route of options.routes) {
    const identity = `${route.method} ${route.path}`;
    if (seen.has(identity))
      throw new Error(`Proxy route collision: ${identity}`);
    seen.add(identity);
    const upstream = upstreams.get(route.upstream);
    if (upstream === undefined)
      throw new TypeError(`Unknown upstream: ${route.upstream}`);
    const timeoutMs = positiveInteger(
      route.timeoutMs ?? 10_000,
      "timeoutMs",
      300_000,
    );
    const maximum = positiveInteger(
      route.maxResponseBytes ?? 8 * 1024 * 1024,
      "maxResponseBytes",
    );
    const retries = route.retries ?? 0;
    if (
      !Number.isSafeInteger(retries) ||
      retries < 0 ||
      retries > 2 ||
      (retries > 0 && !retryable(route.method))
    )
      throw new RangeError("retries must be 0..2 and require GET or HEAD");
    const reqAllowed = headerNames(route.requestHeaders ?? DEFAULT_REQUEST);
    const resAllowed = headerNames(
      route.responseHeaders ?? DEFAULT_RESPONSE,
      true,
    );
    validateTemplate(route.upstreamPath ?? route.path);
    const handler = async function proxyRouteHandler(
      req: Request<A, C>,
      res: Response,
    ): Promise<void> {
      const path = rewrite(route.upstreamPath ?? req.path, req);
      const target = new URL(
        `${upstream.basePath}${path}${route.forwardQuery === false ? "" : query(req)}`,
        upstream.origin,
      );
      if (target.origin !== upstream.origin.origin)
        throw new Error("resolved proxy target escaped the trusted origin");
      let lastStatus: number | undefined;
      for (let attempt = 0; attempt <= retries; attempt++) {
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), timeoutMs);
        try {
          const init: RequestInit = {
            method: req.method,
            headers: requestHeaders(req, reqAllowed, upstream.headers),
            redirect: "manual",
            signal: abort.signal,
          };
          if (req.body !== undefined) init.body = req.body;
          const upstreamResponse = await (options.fetch ?? fetch)(target, init);
          lastStatus = upstreamResponse.status;
          if (attempt < retries && retryable(req.method, lastStatus)) {
            await upstreamResponse.body?.cancel();
            continue;
          }
          const body = await boundedBody(upstreamResponse, maximum, abort);
          res.statusCode = upstreamResponse.status;
          for (const name of resAllowed) {
            const value = upstreamResponse.headers.get(name);
            if (value !== null) res.headers.set(name, value);
          }
          if (
            req.method === "HEAD" ||
            upstreamResponse.status === 204 ||
            upstreamResponse.status === 304
          )
            await res.end();
          else await res.send(body);
          return;
        } catch (error) {
          options.onError?.(error, {
            route: route.path,
            upstream: route.upstream,
            attempt,
          });
          if (attempt < retries && retryable(req.method)) continue;
          res.statusCode =
            error instanceof DOMException && error.name === "AbortError"
              ? 504
              : 502;
          await res.send(
            res.statusCode === 504 ? "Gateway Timeout" : "Bad Gateway",
          );
          return;
        } finally {
          clearTimeout(timer);
        }
      }
      res.statusCode = lastStatus ?? 502;
      await res.send("Bad Gateway");
    };
    registrations.push({ route, handler });
  }
  installed.add(app);
  for (const { route, handler } of registrations)
    app.route(
      route.method,
      route.path,
      ...(route.metadata === undefined ? [] : [route.metadata]),
      handler,
    );
  return Object.freeze({ routes: Object.freeze([...seen]) });
}
