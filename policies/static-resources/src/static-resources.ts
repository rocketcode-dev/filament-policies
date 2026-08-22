import type {
  Application,
  ContextMeta,
  FrameworkMeta,
  Request,
  Response,
} from "filamentjs";
import { parseRefreshInterval } from "./refresh.js";
import type {
  Mount,
  ResourceMetadata,
  SetupOptions,
  SetupResult,
} from "./types.js";

const installed = new WeakSet<object>();

function mountPath(value: string): string {
  if (
    !value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.includes(":")
  ) {
    throw new TypeError("mount path must be an absolute literal URL path");
  }
  const normalized = value === "/" ? "" : value.replace(/\/$/, "");
  if (
    normalized.includes("//") ||
    normalized.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new TypeError("mount path is ambiguous");
  }
  return normalized;
}

function resourcePath(key: string, allowDotfiles: boolean): string {
  if (
    key.startsWith("/") ||
    key.endsWith("/") ||
    key.includes("\\") ||
    key.includes("\0")
  ) {
    throw new TypeError(`Invalid resource key: ${key}`);
  }
  const parts = key.split("/");
  if (
    parts.some(
      (part) =>
        part === "" ||
        part === "." ||
        part === ".." ||
        (!allowDotfiles && part.startsWith(".")),
    )
  ) {
    throw new TypeError(`Unsafe resource key: ${key}`);
  }
  return parts.map(encodeURIComponent).join("/");
}

function header(req: Request, name: string): string | undefined {
  const value = req.headers.get(name);
  return Array.isArray(value) ? value.join(",") : (value ?? undefined);
}

function etagMatches(value: string, etag: string): boolean {
  const wanted = etag.replace(/^W\//, "");
  return value.split(",").some((part) => {
    const candidate = part.trim();
    return candidate === "*" || candidate.replace(/^W\//, "") === wanted;
  });
}

function notModified(req: Request, metadata: ResourceMetadata): boolean {
  const ifNoneMatch = header(req, "if-none-match");
  if (ifNoneMatch !== undefined)
    return (
      metadata.etag !== undefined && etagMatches(ifNoneMatch, metadata.etag)
    );
  const ims = header(req, "if-modified-since");
  if (ims === undefined || metadata.lastModified === undefined) return false;
  const timestamp = Date.parse(ims);
  if (!Number.isFinite(timestamp)) return false;
  return (
    Math.floor(metadata.lastModified.getTime() / 1_000) <=
    Math.floor(timestamp / 1_000)
  );
}

function setHeaders(
  res: Response,
  metadata: ResourceMetadata,
  cacheControl?: string,
): void {
  res.headers.set("Content-Length", metadata.byteLength.toString());
  res.headers.set(
    "Content-Type",
    metadata.contentType ?? "application/octet-stream",
  );
  if (metadata.lastModified !== undefined)
    res.headers.set("Last-Modified", metadata.lastModified.toUTCString());
  if (metadata.etag !== undefined) res.headers.set("ETag", metadata.etag);
  if (cacheControl !== undefined)
    res.headers.set("Cache-Control", cacheControl);
  res.headers.set("X-Content-Type-Options", "nosniff");
}
function validateMetadata(
  metadata: ResourceMetadata,
  expectedKey: string,
  maximum: number,
): void {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    metadata.key !== expectedKey ||
    !Number.isSafeInteger(metadata.byteLength) ||
    metadata.byteLength < 0 ||
    metadata.byteLength > maximum ||
    (metadata.lastModified !== undefined &&
      (!(metadata.lastModified instanceof Date) ||
        !Number.isFinite(metadata.lastModified.getTime()))) ||
    (metadata.contentType !== undefined &&
      (typeof metadata.contentType !== "string" ||
        metadata.contentType.length > 256 ||
        /[\x00-\x1F\x7F]/.test(metadata.contentType))) ||
    (metadata.etag !== undefined &&
      (typeof metadata.etag !== "string" ||
        metadata.etag.length > 1024 ||
        /[\x00-\x1F\x7F]/.test(metadata.etag))) ||
    (metadata.version !== undefined &&
      (typeof metadata.version !== "string" || metadata.version.length > 1024))
  )
    throw new Error(`Invalid resource metadata for ${expectedKey}`);
}
function clearRepresentationHeaders(res: Response): void {
  res.headers.removeMany(
    "Content-Length",
    "Content-Type",
    "Last-Modified",
    "ETag",
    "Cache-Control",
  );
}

async function respond(
  req: Request,
  res: Response,
  mount: Mount,
  key: string,
  state: { current: ResourceMetadata | undefined; checkedAt: number },
  refreshMs: number,
  now: () => number,
  onError: NonNullable<SetupOptions["onError"]>,
): Promise<void> {
  if (now() - state.checkedAt >= refreshMs) {
    try {
      const refreshed = await mount.store.metadata(key);
      if (refreshed !== undefined)
        validateMetadata(
          refreshed,
          key,
          mount.maxBytes ?? 16 * 1024 * 1024,
        );
      state.current = refreshed;
      state.checkedAt = now();
    } catch (cause) {
      const error =
        cause instanceof Error
          ? cause
          : new Error("Resource metadata failed", { cause });
      onError(error, { mount: mount.path, key });
      res.statusCode = 503;
      await res.send("Static resource unavailable");
      return;
    }
  }
  const metadata = state.current;
  if (metadata === undefined) {
    res.statusCode = 404;
    await res.send("Not Found");
    return;
  }
  setHeaders(res, metadata, mount.cacheControl);
  if (notModified(req, metadata)) {
    res.statusCode = 304;
    res.headers.set("Content-Length", "0");
    await res.end();
    return;
  }
  if (req.method === "HEAD") {
    await res.end();
    return;
  }
  try {
    const body = await mount.store.read(key, metadata);
    const limit = mount.maxBytes ?? 16 * 1024 * 1024;
    if (!Buffer.isBuffer(body) || body.byteLength > limit)
      throw new Error("Resource body is invalid or exceeds maxBytes");
    if (body.byteLength !== metadata.byteLength)
      res.headers.set("Content-Length", body.byteLength.toString());
    await res.send(body);
  } catch (cause) {
    const error =
      cause instanceof Error
        ? cause
        : new Error("Resource read failed", { cause });
    onError(error, { mount: mount.path, key });
    if (!res.closed) {
      clearRepresentationHeaders(res);
      res.statusCode = 503;
      await res.send("Static resource unavailable");
    }
  }
}

export async function setup<A extends FrameworkMeta, C extends ContextMeta>(
  app: Application<A, C>,
  options: SetupOptions<A>,
): Promise<SetupResult> {
  if (installed.has(app))
    throw new Error(
      "static-resources is already installed on this application",
    );
  if (options.mounts.length === 0)
    throw new TypeError("at least one mount is required");
  const now = options.now ?? Date.now;
  const onError =
    options.onError ??
    ((error: Error) => console.error("[filamentjs:static-resources]", error));
  const registrations: Array<{
    method: "GET" | "HEAD";
    path: string;
    metadata?: Partial<A>;
    handler: (req: Request<A, C>, res: Response) => Promise<void>;
  }> = [];
  const paths = new Set<string>();

  for (const mount of options.mounts) {
    const base = mountPath(mount.path);
    const refreshMs = parseRefreshInterval(mount.refresh);
    const maximum = mount.maxBytes ?? 16 * 1024 * 1024;
    if (!Number.isSafeInteger(maximum) || maximum < 0)
      throw new RangeError("maxBytes must be a non-negative safe integer");
    if (
      mount.cacheControl !== undefined &&
      (mount.cacheControl.length > 1024 ||
        /[\x00-\x1F\x7F]/.test(mount.cacheControl))
    )
      throw new TypeError("cacheControl is invalid");
    const manifest = await mount.store.list();
    for (const item of manifest) {
      validateMetadata(item, item.key, maximum);
      const path = `${base}/${resourcePath(item.key, mount.allowDotfiles ?? false)}`;
      if (paths.has(path)) throw new Error(`Static route collision: ${path}`);
      paths.add(path);
      const state = { current: { ...item }, checkedAt: now() };
      const handler = async function staticResourceHandler(
        req: Request<A, C>,
        res: Response,
      ): Promise<void> {
        await respond(req, res, mount, item.key, state, refreshMs, now, onError);
      };
      registrations.push({
        method: "GET",
        path,
        ...(mount.metadata === undefined ? {} : { metadata: mount.metadata }),
        handler,
      });
      registrations.push({
        method: "HEAD",
        path,
        ...(mount.metadata === undefined ? {} : { metadata: mount.metadata }),
        handler,
      });
    }
  }

  installed.add(app);
  for (const registration of registrations) {
    app.route(
      registration.method,
      registration.path,
      ...(registration.metadata === undefined ? [] : [registration.metadata]),
      registration.handler,
    );
  }
  return Object.freeze({ routes: Object.freeze([...paths]) });
}
