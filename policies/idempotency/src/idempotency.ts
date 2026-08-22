import { createHash } from "node:crypto";
import type {
  Application,
  ContextMeta as BaseContext,
  FrameworkMeta,
  Request,
  Response,
} from "filamentjs";
import type {
  AppMeta,
  ContextMeta,
  IdempotencyRecord,
  SetupOptions,
} from "./types.js";
const installed = new WeakSet<object>();
const SAFE_HEADERS = ["content-language", "content-type", "etag", "location"];
function header(req: Request, name: string): string | undefined {
  const value = req.headers.get(name);
  return Array.isArray(value)
    ? value.length === 1
      ? value[0]
      : undefined
    : (value ?? undefined);
}
function canonicalQuery(req: Request): string {
  return Object.entries(req.query)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([name, value]) =>
      (Array.isArray(value) ? value : [value]).map(
        (item) => `${encodeURIComponent(name)}=${encodeURIComponent(item)}`,
      ),
    )
    .join("&");
}
function fingerprint(req: Request): string {
  const hash = createHash("sha256");
  hash.update(req.method);
  hash.update("\0");
  hash.update(req.path);
  hash.update("\0");
  hash.update(canonicalQuery(req));
  hash.update("\0");
  hash.update(header(req, "content-type") ?? "");
  hash.update("\0");
  hash.update(req.body ?? Buffer.alloc(0));
  return hash.digest("base64url");
}
function record(
  res: Response,
  body: Buffer,
  fingerprintValue: string,
): IdempotencyRecord {
  const headers: Record<string, string> = {};
  for (const name of SAFE_HEADERS) {
    const value = res.headers.get(name);
    if (typeof value === "string") headers[name] = value;
  }
  return {
    fingerprint: fingerprintValue,
    statusCode: res.statusCode,
    headers,
    body: Buffer.from(body),
  };
}
function validReplay(
  value: IdempotencyRecord,
  expectedFingerprint: string,
  maximum: number,
): boolean {
  if (
    typeof value !== "object" ||
    value === null ||
    value.fingerprint !== expectedFingerprint ||
    !Number.isSafeInteger(value.statusCode) ||
    value.statusCode < 200 ||
    value.statusCode > 599 ||
    !Buffer.isBuffer(value.body) ||
    value.body.byteLength > maximum ||
    typeof value.headers !== "object" ||
    value.headers === null
  )
    return false;
  return Object.entries(value.headers).every(
    ([name, field]) =>
      name === name.toLowerCase() &&
      SAFE_HEADERS.includes(name) &&
      typeof field === "string",
  );
}
async function replay(res: Response, value: IdempotencyRecord): Promise<void> {
  res.statusCode = value.statusCode;
  for (const [name, field] of Object.entries(value.headers))
    res.headers.set(name, field);
  res.headers.set("Idempotency-Replayed", "true");
  await res.send(value.body);
}
export function setup<
  A extends FrameworkMeta & AppMeta,
  C extends BaseContext & ContextMeta,
>(app: Application<A, C>, options: SetupOptions): void {
  if (installed.has(app))
    throw new Error("idempotency is already installed on this application");
  const ttlDefault = options.defaultTtlSeconds ?? 86_400,
    maximum = options.maxBodyBytes ?? 4 * 1024 * 1024;
  if (
    !Number.isSafeInteger(ttlDefault) ||
    ttlDefault < 1 ||
    !Number.isSafeInteger(maximum) ||
    maximum < 1
  )
    throw new RangeError("idempotency TTL and body limit must be positive");
  async function idempotencyMiddleware(
    req: Request<A, C>,
    res: Response,
  ): Promise<void> {
    const config = req.endpointMeta.idempotency;
    if (config === false || config === undefined) return;
    if (req.method !== "POST" && req.method !== "PATCH") {
      res.statusCode = 500;
      await res.send("Idempotency configuration error");
      return;
    }
    const raw = req.headers.get("idempotency-key");
    const key = Array.isArray(raw)
      ? raw.length === 1
        ? raw[0]
        : undefined
      : (raw ?? undefined);
    if (key === undefined) {
      if (config.required !== false) {
        res.statusCode = 400;
        await res.send("Idempotency-Key is required");
      }
      return;
    }
    if (key.length < 1 || key.length > 255 || !/^[\x21-\x7E]+$/.test(key)) {
      res.statusCode = 400;
      await res.send("Invalid Idempotency-Key");
      return;
    }
    const ttl = config.ttlSeconds ?? ttlDefault;
    if (!Number.isSafeInteger(ttl) || ttl < 1) {
      res.statusCode = 500;
      await res.send("Idempotency configuration error");
      return;
    }
    const scope = await options.resolveScope(req);
    if (!scope || scope.length > 1024 || scope.includes("\0")) {
      res.statusCode = 401;
      await res.send("Idempotency scope unavailable");
      return;
    }
    const scoped = `${scope}\0${req.method}\0${req.path}`;
    const print = fingerprint(req);
    try {
      const result = await options.store.acquire(
        scoped,
        key,
        print,
        ttl * 1_000,
      );
      if (result.status === "conflict") {
        res.statusCode = 409;
        await res.send("Idempotency-Key conflicts with an earlier request");
        return;
      }
      if (result.status === "in-progress") {
        res.statusCode = 409;
        await res.send("An operation with this Idempotency-Key is in progress");
        return;
      }
      if (result.status === "replay") {
        if (!validReplay(result.record, print, maximum))
          throw new Error("idempotency store returned an invalid replay");
        await replay(res, result.record);
        return;
      }
      if (
        result.status !== "acquired" ||
        typeof result.token !== "string" ||
        result.token.length < 1 ||
        result.token.length > 1024 ||
        result.token.includes("\u0000")
      )
        throw new Error("idempotency store returned an invalid acquisition");
      res.streaming = false;
      const state = (req.context.idempotency = {
        scope: scoped,
        key,
        fingerprint: print,
        token: result.token,
        ttlMs: ttl * 1_000,
        captured: [] as Buffer[],
        completed: false,
      });
      res.on("send", (data) => state.captured.push(Buffer.from(data)));
      res.on("sendChunk", (data) => state.captured.push(Buffer.from(data)));
    } catch (error) {
      options.onError?.(error);
      res.statusCode = 503;
      await res.send("Idempotency store unavailable");
    }
  }
  async function idempotencyCapture(
    req: Request<A, C>,
    res: Response,
  ): Promise<void> {
    const state = req.context.idempotency;
    if (!state || state.completed || res.streaming) return;
    const body = res.body;
    try {
      if (body === null || body.byteLength > maximum)
        throw new Error("Idempotent response cannot be safely captured");
      const saved = await options.store.complete(
        state.scope,
        state.key,
        state.token,
        record(res, body, state.fingerprint),
        state.ttlMs,
      );
      if (saved !== true)
        throw new Error("Idempotency lease ownership was lost");
      state.completed = true;
    } catch (error) {
      options.onError?.(error);
      state.completed = true;
      res.statusCode = 503;
      res.headers.set("Content-Type", "text/plain; charset=utf-8");
      res.body = "Idempotency store unavailable";
    }
  }
  async function idempotencyFinalizer(
    req: Request<A, C>,
    res: Response,
  ): Promise<void> {
    const state = req.context.idempotency;
    if (!state || state.completed) return;
    const body = Buffer.concat(state.captured);
    if (body.byteLength > maximum) {
      options.onError?.(
        new Error("Idempotent response exceeded capture limit"),
      );
      return;
    }
    try {
      const saved = await options.store.complete(
        state.scope,
        state.key,
        state.token,
        record(res, body, state.fingerprint),
        state.ttlMs,
      );
      if (saved !== true)
        throw new Error("Idempotency lease ownership was lost");
      state.completed = true;
    } catch (error) {
      options.onError?.(error);
    }
  }
  app.use(idempotencyMiddleware);
  app.onTransform(idempotencyCapture);
  app.onFinalize(idempotencyFinalizer);
  installed.add(app);
}
