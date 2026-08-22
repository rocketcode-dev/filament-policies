import type {
  Application,
  ContextMeta as BaseContext,
  FrameworkMeta,
  Request,
  Response,
} from "filamentjs";
import type { AppMeta, ContextMeta, SetupOptions } from "./types.js";
const installed = new WeakSet<object>();
function formDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    throw new Error("Malformed OAuth Basic credentials");
  }
}
function parseBasic(
  value: string,
  maximum: number,
): { clientId: string; secret: string } {
  if (!/^Basic\s+/i.test(value))
    throw new Error("Unsupported OAuth client authentication method");
  const encoded = value.replace(/^Basic\s+/i, "");
  if (
    encoded.length === 0 ||
    encoded.length > maximum * 2 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    throw new Error("Malformed OAuth Basic credentials");
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  if (Buffer.byteLength(decoded) > maximum || decoded.includes("\uFFFD"))
    throw new Error("Malformed OAuth Basic credentials");
  const separator = decoded.indexOf(":");
  if (separator < 0) throw new Error("Malformed OAuth Basic credentials");
  const clientId = formDecode(decoded.slice(0, separator)),
    secret = formDecode(decoded.slice(separator + 1));
  if (!clientId || !secret)
    throw new Error("Malformed OAuth Basic credentials");
  return { clientId, secret };
}
function hasBodyCredentials(req: Request): boolean {
  if (!req.body) return false;
  const type = req.headers.get("content-type");
  if (
    typeof type !== "string" ||
    !type.toLowerCase().startsWith("application/x-www-form-urlencoded")
  )
    return false;
  const params = new URLSearchParams(req.body.toString("utf8"));
  return params.has("client_secret");
}
async function invalid(res: Response, realm: string): Promise<void> {
  res.statusCode = 401;
  res.headers.set("WWW-Authenticate", `Basic realm=\"${realm}\"`);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Pragma", "no-cache");
  await res.json({ error: "invalid_client" });
}
export function setup<
  A extends FrameworkMeta & AppMeta,
  C extends BaseContext & ContextMeta,
>(app: Application<A, C>, options: SetupOptions): void {
  if (installed.has(app))
    throw new Error("oauth-client-authentication is already installed");
  if (!options.allowInsecureDevelopment && !options.assertSecureTransport)
    throw new TypeError(
      "assertSecureTransport is required unless insecure development is explicit",
    );
  const maximum = options.maxCredentialBytes ?? 4096,
    realm = options.realm ?? "oauth";
  if (!Number.isSafeInteger(maximum) || maximum < 64 || maximum > 65_536)
    throw new RangeError("maxCredentialBytes is invalid");
  if (!/^[\x20-\x21\x23-\x7E]{1,128}$/.test(realm))
    throw new TypeError("realm is invalid");
  async function oauthClientAuthentication(
    req: Request<A, C>,
    res: Response,
  ): Promise<void> {
    const config = req.endpointMeta.oauthClientAuthentication;
    if (config === false || config === undefined) return;
    try {
      if (
        !options.allowInsecureDevelopment &&
        !(await options.assertSecureTransport!(req))
      ) {
        await invalid(res, realm);
        return;
      }
      const authorization = req.headers.get("authorization");
      const value = Array.isArray(authorization)
        ? authorization.length === 1
          ? authorization[0]
          : undefined
        : (authorization ?? undefined);
      if (value === undefined) {
        if (config.required !== false) await invalid(res, realm);
        return;
      }
      if (value.includes(",") || hasBodyCredentials(req)) {
        await invalid(res, realm);
        return;
      }
      const credentials = parseBasic(value, maximum);
      const clientIdentity = await options.authenticate(
        credentials.clientId,
        credentials.secret,
        req,
      );
      if (!clientIdentity || clientIdentity.clientId !== credentials.clientId) {
        await invalid(res, realm);
        return;
      }
      req.context.oauth ??= {};
      req.context.oauth.client = Object.freeze({
        ...clientIdentity,
        ...(clientIdentity.scopes === undefined
          ? {}
          : { scopes: Object.freeze([...clientIdentity.scopes]) }),
        ...(clientIdentity.claims === undefined
          ? {}
          : { claims: Object.freeze({ ...clientIdentity.claims }) }),
      });
    } catch (error) {
      options.onError?.(error);
      await invalid(res, realm);
    }
  }
  app.use(oauthClientAuthentication);
  installed.add(app);
}
