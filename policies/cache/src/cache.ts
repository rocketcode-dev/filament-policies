import type {
  Application,
  ContextMeta as BaseContext,
  FrameworkMeta,
  Request,
  Response,
} from "filamentjs";
import type {
  AppMeta,
  CacheEntry,
  ContextMeta,
  SetupOptions,
} from "./types.js";
const installed = new WeakSet<object>();
const SAFE_HEADERS = [
  "cache-control",
  "content-language",
  "content-type",
  "etag",
  "expires",
  "last-modified",
  "vary",
];
function one(req: Request, name: string): string | undefined {
  const value = req.headers.get(name);
  return Array.isArray(value) ? value.join(",") : (value ?? undefined);
}
function defaultKey(req: Request & { context: ContextMeta }): string {
  const query = Object.entries(req.query)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([name, value]) =>
      (Array.isArray(value) ? value : [value]).map(
        (item) => `${encodeURIComponent(name)}=${encodeURIComponent(item)}`,
      ),
    )
    .join("&");
  return `GET ${req.path}?${query}\0format=${req.context.outputFormat?.format ?? "identity"}`;
}
function matches(value: string, etag: string): boolean {
  const wanted = etag.replace(/^W\//, "");
  return value
    .split(",")
    .some(
      (item) =>
        item.trim() === "*" || item.trim().replace(/^W\//, "") === wanted,
    );
}
function replayHeaders(res: Response, entry: CacheEntry): void {
  for (const [name, value] of Object.entries(entry.headers))
    res.headers.set(name, value);
}
function hasHeader(res: Response, name: string): boolean {
  const value = res.headers.get(name);
  return Array.isArray(value) ? value.length > 0 : value !== null;
}
function validEntry(entry: CacheEntry, maximum: number): boolean {
  if (
    typeof entry !== "object" ||
    entry === null ||
    entry.statusCode !== 200 ||
    !Buffer.isBuffer(entry.body) ||
    entry.body.byteLength > maximum ||
    !Number.isFinite(entry.storedAt) ||
    !Number.isFinite(entry.expiresAt) ||
    entry.expiresAt < entry.storedAt ||
    typeof entry.headers !== "object" ||
    entry.headers === null ||
    (entry.etag !== undefined && typeof entry.etag !== "string")
  )
    return false;
  return Object.entries(entry.headers).every(
    ([name, value]) =>
      name === name.toLowerCase() &&
      SAFE_HEADERS.includes(name) &&
      typeof value === "string",
  ) &&
    (entry.etag === undefined || entry.headers.etag === entry.etag);
}
export function setup<
  A extends FrameworkMeta & AppMeta,
  C extends BaseContext & ContextMeta,
>(app: Application<A, C>, options: SetupOptions): void {
  if (installed.has(app))
    throw new Error("cache is already installed on this application");
  const ttlDefault = options.defaultTtlSeconds ?? 60,
    maximum = options.maxBodyBytes ?? 4 * 1024 * 1024,
    now = options.now ?? Date.now;
  if (
    !Number.isSafeInteger(ttlDefault) ||
    ttlDefault < 1 ||
    !Number.isSafeInteger(maximum) ||
    maximum < 1
  )
    throw new RangeError(
      "cache TTL and body limit must be positive safe integers",
    );
  async function cacheLookup(req: Request<A, C>, res: Response): Promise<void> {
    const config = req.endpointMeta.cache;
    if (
      config === false ||
      config === undefined ||
      (req.method !== "GET" && req.method !== "HEAD")
    )
      return;
    const ttl = config.ttlSeconds ?? ttlDefault;
    if (!Number.isSafeInteger(ttl) || ttl < 1) {
      res.statusCode = 500;
      await res.send("Cache configuration error");
      return;
    }
    if (
      one(req, "authorization") !== undefined ||
      one(req, "cookie") !== undefined
    ) {
      req.context.cache = { key: "", ttlMs: ttl * 1_000, result: "bypass" };
      return;
    }
    const partition = await options.key?.(req);
    const key =
      partition === undefined
        ? defaultKey(req as Request & { context: ContextMeta })
        : `${defaultKey(req as Request & { context: ContextMeta })}\0partition=${partition}`;
    if (key.length > 4_096 || key.includes("\r") || key.includes("\n")) {
      res.statusCode = 500;
      await res.send("Cache key error");
      return;
    }
    req.context.cache = { key, ttlMs: ttl * 1_000, result: "miss" };
    try {
      const entry = await options.store.get(key);
      if (!entry) return;
      if (!validEntry(entry, maximum))
        throw new Error("cache store returned an invalid entry");
      if (entry.expiresAt <= now()) {
        await options.store.delete(key);
        return;
      }
      req.context.cache = { key, ttlMs: ttl * 1_000, result: "hit" };
      replayHeaders(res, entry);
      res.headers.set(
        "Age",
        Math.max(0, Math.floor((now() - entry.storedAt) / 1_000)).toString(),
      );
      res.headers.set("X-Cache", "HIT");
      if (
        entry.etag &&
        one(req, "if-none-match") &&
        matches(one(req, "if-none-match")!, entry.etag)
      ) {
        res.statusCode = 304;
        await res.end();
      } else {
        res.statusCode = entry.statusCode;
        if (req.method === "HEAD") await res.end();
        else await res.send(entry.body);
      }
    } catch (error) {
      options.onError?.(error);
      res.statusCode = 503;
      await res.send("Cache unavailable");
    }
  }
  async function cacheCapture(
    req: Request<A, C>,
    res: Response,
  ): Promise<void> {
    const state = req.context.cache;
    if (
      !state ||
      state.result !== "miss" ||
      req.method !== "GET" ||
      res.statusCode !== 200 ||
      res.streaming
    )
      return;
    const body = res.body;
    if (!body || body.byteLength > maximum) return;
    const cacheControlValue = res.headers.get("cache-control");
    const cacheControl = Array.isArray(cacheControlValue)
      ? cacheControlValue.join(",")
      : (cacheControlValue ?? "");
    if (
      /(?:^|,)\s*(?:no-store|private)\b/i.test(cacheControl) ||
      hasHeader(res, "set-cookie")
    )
      return;
    try {
      const etag =
        options.etag === false || options.etag === undefined
          ? undefined
          : await options.etag(body);
      if (etag !== undefined) res.headers.set("ETag", etag);
      const headers: Record<string, string> = {};
      for (const name of SAFE_HEADERS) {
        const value = res.headers.get(name);
        if (typeof value === "string") headers[name] = value;
      }
      const timestamp = now();
      await options.store.set(state.key, {
        statusCode: res.statusCode,
        headers,
        body: Buffer.from(body),
        storedAt: timestamp,
        expiresAt: timestamp + state.ttlMs,
        ...(etag === undefined ? {} : { etag }),
      });
      res.headers.set("X-Cache", "MISS");
    } catch (error) {
      options.onError?.(
        error,
      ); /* response generation succeeds; cache population failure is contained */
    }
  }
  app.use(cacheLookup);
  app.onTransform(cacheCapture);
  installed.add(app);
}
