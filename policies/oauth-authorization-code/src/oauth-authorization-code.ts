import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isUserInfo, type UserInfo } from "@filamentjs/foundation";
import type {
  Application,
  ContextMeta as BaseContext,
  FrameworkMeta,
  Request,
  Response,
} from "filamentjs";
import type {
  AppMeta,
  AuthorizationRequest,
  ClientRecord,
  ContextMeta,
  OAuthResourceOwner,
  SetupOptions,
  SetupResult,
  StoredCode,
  StoredToken,
} from "./types.js";
const installed = new WeakSet<object>();
const PKCE = /^[A-Za-z0-9._~-]{43,128}$/;
const SCOPE = /^[\x21\x23-\x5B\x5D-\x7E]+$/;
class InputError extends Error {}
function path(value: string | undefined): string {
  const result = (value ?? "/oauth").replace(/\/$/, "");
  if (
    !result.startsWith("/") ||
    result === "" ||
    result.includes(":") ||
    result.includes("\\") ||
    result.split("/").some((item) => item === "." || item === "..")
  )
    throw new TypeError("basePath is invalid");
  return result;
}
function one(
  value: string | string[] | undefined,
  name: string,
  required = true,
): string | undefined {
  if (Array.isArray(value)) throw new InputError(`duplicate ${name}`);
  if ((value === undefined || value === "") && required)
    throw new InputError(`missing ${name}`);
  return value || undefined;
}
function scopes(value: string | undefined): string[] {
  if (!value) return [];
  const result = value.split(" ");
  if (
    result.some((item) => !SCOPE.test(item)) ||
    new Set(result).size !== result.length
  )
    throw new InputError("invalid scope");
  return result;
}
function validClient(
  client: ClientRecord | undefined,
  id: string,
): client is ClientRecord {
  return (
    client !== undefined &&
    client.clientId === id &&
    (client.type === "public" || client.type === "confidential") &&
    client.redirectUris.length > 0 &&
    new Set(client.redirectUris).size === client.redirectUris.length &&
    client.redirectUris.every(validRedirect) &&
    new Set(client.allowedScopes).size === client.allowedScopes.length &&
    client.allowedScopes.every((scope) => SCOPE.test(scope))
  );
}
function validRedirect(value: string): boolean {
  try {
    const uri = new URL(value);
    return (
      uri.protocol.length > 1 &&
      !["javascript:", "data:", "file:"].includes(uri.protocol) &&
      uri.hash === "" &&
      uri.username === "" &&
      uri.password === ""
    );
  } catch {
    return false;
  }
}
function validScopeList(value: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    new Set(value).size === value.length &&
    value.every((scope) => typeof scope === "string" && SCOPE.test(scope))
  );
}
function validClaims(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validResourceOwner(value: unknown): value is OAuthResourceOwner {
  return (
    typeof value === "object" &&
    value !== null &&
    "subject" in value &&
    typeof value.subject === "string" &&
    value.subject.length > 0 &&
    (!("claims" in value) ||
      value.claims === undefined ||
      validClaims(value.claims))
  );
}
function claimString(
  claims: Readonly<Record<string, unknown>> | undefined,
  ...names: readonly string[]
): string | undefined {
  for (const name of names) {
    const value = claims?.[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}
function immutableRoles(roles: readonly string[]): string[] {
  return Object.freeze([...roles]) as unknown as string[];
}
function defaultUser(
  resourceOwner: OAuthResourceOwner,
  grantedScopes: readonly string[],
): UserInfo {
  const claims = resourceOwner.claims,
    fullName = claimString(claims, "name", "full_name", "fullName"),
    shortName = claimString(claims, "nickname", "short_name", "shortName"),
    emailAddress = claimString(claims, "email", "emailAddress"),
    emailVerified = claims?.email_verified ?? claims?.emailVerified,
    realm = claimString(claims, "realm");
  return {
    id: resourceOwner.subject,
    username:
      claimString(claims, "preferred_username", "username") ??
      resourceOwner.subject,
    ...(realm ? { realm } : {}),
    ...(emailAddress ? { emailAddress } : {}),
    ...(typeof emailVerified === "boolean" ? { emailVerified } : {}),
    ...(fullName ? { fullName } : {}),
    ...(shortName ? { shortName } : {}),
    ...(grantedScopes.length > 0
      ? { roles: immutableRoles(grantedScopes) }
      : {}),
  };
}
function immutableUser(user: UserInfo): UserInfo {
  return Object.freeze({
    ...structuredClone(user),
    ...(user.roles === undefined
      ? {}
      : { roles: immutableRoles(user.roles) }),
  });
}
function validTransaction(value: AuthorizationRequest): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    validClient(value.client, value.client?.clientId) &&
    typeof value.redirectUri === "string" &&
    value.client.redirectUris.includes(value.redirectUri) &&
    validScopeList(value.requestedScopes) &&
    value.requestedScopes.every((scope) =>
      value.client.allowedScopes.includes(scope),
    ) &&
    (value.state === undefined ||
      (typeof value.state === "string" &&
        value.state.length <= 1024 &&
        !/[\x00-\x20\x7F]/.test(value.state))) &&
    typeof value.codeChallenge === "string" &&
    PKCE.test(value.codeChallenge)
  );
}
function validCode(value: StoredCode): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.clientId === "string" &&
    value.clientId.length > 0 &&
    (value.clientType === "public" || value.clientType === "confidential") &&
    typeof value.redirectUri === "string" &&
    validRedirect(value.redirectUri) &&
    validScopeList(value.scopes) &&
    validResourceOwner(value.resourceOwner) &&
    isUserInfo(value.user) &&
    typeof value.codeChallenge === "string" &&
    PKCE.test(value.codeChallenge)
  );
}
function validToken(value: StoredToken): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.client === "object" &&
    value.client !== null &&
    typeof value.client.clientId === "string" &&
    value.client.clientId.length > 0 &&
    (value.client.scopes === undefined || validScopeList(value.client.scopes)) &&
    validResourceOwner(value.resourceOwner) &&
    isUserInfo(value.user) &&
    validScopeList(value.scopes) &&
    typeof value.expiresAt === "number" &&
    Number.isFinite(value.expiresAt)
  );
}
function noStore(res: Response): void {
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Referrer-Policy", "no-referrer");
}
async function jsonError(
  res: Response,
  error: string,
  status = 400,
): Promise<void> {
  res.statusCode = status;
  noStore(res);
  await res.json({ error });
}
async function invalidClient(res: Response): Promise<void> {
  res.headers.set("WWW-Authenticate", 'Basic realm="oauth"');
  await jsonError(res, "invalid_client", 401);
}
async function redirect(
  res: Response,
  uri: string,
  fields: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  const target = new URL(uri);
  for (const [name, value] of Object.entries(fields))
    if (value !== undefined) target.searchParams.append(name, value);
  res.statusCode = 302;
  noStore(res);
  res.headers.set("Location", target.toString());
  await res.end();
}
function form(req: Request): URLSearchParams {
  const type = req.headers.get("content-type");
  if (
    typeof type !== "string" ||
    !type.toLowerCase().startsWith("application/x-www-form-urlencoded") ||
    !req.body ||
    req.body.byteLength > 16_384
  )
    throw new InputError("invalid_request");
  return new URLSearchParams(req.body.toString("utf8"));
}
function formOne(
  params: URLSearchParams,
  name: string,
  required = true,
): string | undefined {
  const values = params.getAll(name);
  if (values.length > 1) throw new InputError("invalid_request");
  const value = values[0];
  if ((value === undefined || value === "") && required)
    throw new InputError("invalid_request");
  return value || undefined;
}
function pkce(verifier: string, challenge: string): boolean {
  if (!PKCE.test(verifier)) return false;
  const actual = createHash("sha256")
    .update(verifier, "ascii")
    .digest("base64url");
  const a = Buffer.from(actual),
    b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}
function bearer(req: Request): string | undefined {
  const value = req.headers.get("authorization");
  const text = Array.isArray(value)
    ? value.length === 1
      ? value[0]
      : undefined
    : (value ?? undefined);
  if (!text) return undefined;
  const match = /^Bearer ([A-Za-z0-9._~-]{32,512})$/.exec(text);
  return match?.[1];
}
async function bearerError(
  res: Response,
  error: "invalid_token" | "insufficient_scope",
  status: number,
  scope?: readonly string[],
): Promise<void> {
  res.statusCode = status;
  noStore(res);
  const suffix = scope?.length ? `, scope=\"${scope.join(" ")}\"` : "";
  res.headers.set("WWW-Authenticate", `Bearer error=\"${error}\"${suffix}`);
  await res.json({ error });
}
function randomOpaque(): string {
  return randomBytes(32).toString("base64url");
}
function cookieValue(req: Request, name: string): string | undefined {
  const raw = req.headers.get("cookie");
  const text = Array.isArray(raw) ? raw.join(";") : raw;
  if (!text) return undefined;
  const values = text
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item.startsWith(`${name}=`))
    .map((item) => item.slice(name.length + 1));
  return values.length === 1 && PKCE.test(values[0]!) ? values[0] : undefined;
}
export function setup<
  A extends FrameworkMeta & AppMeta,
  C extends BaseContext & ContextMeta,
>(app: Application<A, C>, options: SetupOptions): SetupResult {
  if (installed.has(app))
    throw new Error("oauth-authorization-code is already installed");
  if (!options.allowInsecureDevelopment && !options.assertSecureTransport)
    throw new TypeError(
      "assertSecureTransport is required unless insecure development is explicit",
    );
  const base = path(options.basePath),
    authorizationPath = `${base}/authorize`,
    continuationPath = `${base}/authorize/continue`,
    tokenPath = `${base}/token`,
    codeTtl = options.codeTtlSeconds ?? 300,
    transactionTtl = options.transactionTtlSeconds ?? 600,
    accessTtl = options.accessTokenTtlSeconds ?? 3600,
    makeToken = options.randomToken ?? randomOpaque,
    now = options.now ?? Date.now;
  if (
    ![codeTtl, transactionTtl, accessTtl].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  )
    throw new RangeError("OAuth TTLs must be positive integers");
  const secure = async (req: Request) =>
    options.allowInsecureDevelopment === true ||
    (await options.assertSecureTransport!(req));
  const transactionCookie = options.allowInsecureDevelopment
    ? "filament-oauth-transaction"
    : "__Host-filament-oauth-transaction";
  const setTransactionCookie = (res: Response, value: string, clear = false) =>
    res.headers.add(
      "Set-Cookie",
      `${transactionCookie}=${value}; Path=/; HttpOnly; SameSite=Strict${options.allowInsecureDevelopment ? "" : "; Secure"}${clear ? "; Max-Age=0" : `; Max-Age=${transactionTtl}`}`,
    );
  async function finishAuthorization(
    req: Request,
    res: Response,
    request: AuthorizationRequest,
    decision: Exclude<
      Awaited<ReturnType<SetupOptions["authorize"]>>,
      undefined | { readonly interaction: true }
    >,
  ): Promise<void> {
    if (!decision.approved) {
      await redirect(res, request.redirectUri, {
        error: "access_denied",
        state: request.state,
      });
      return;
    }
    if (
      !validResourceOwner(decision.resourceOwner) ||
      !validScopeList(decision.scopes)
    )
      throw new Error("authorize hook returned an invalid approval");
    if (
      decision.scopes.some(
        (scope) =>
          !request.requestedScopes.includes(scope) ||
          !request.client.allowedScopes.includes(scope),
      )
    ) {
      await redirect(res, request.redirectUri, {
        error: "invalid_scope",
        state: request.state,
      });
      return;
    }
    const user = await (options.mapUser
      ? options.mapUser(decision.resourceOwner, decision.scopes, req)
      : defaultUser(decision.resourceOwner, decision.scopes));
    if (!isUserInfo(user))
      throw new Error("OAuth user translation returned invalid user information");
    let code = "",
      stored = false;
    for (let attempt = 0; attempt < 3 && !stored; attempt++) {
      code = makeToken();
      if (!PKCE.test(code))
        throw new Error("randomToken returned an invalid opaque value");
      stored = await options.store.putCode(
        code,
        {
          clientId: request.client.clientId,
          clientType: request.client.type,
          redirectUri: request.redirectUri,
          scopes: Object.freeze([...decision.scopes]),
          resourceOwner: structuredClone(decision.resourceOwner),
          user: immutableUser(user),
          codeChallenge: request.codeChallenge,
        },
        codeTtl * 1_000,
      );
    }
    if (!stored)
      throw new Error("could not allocate a unique authorization code");
    await redirect(res, request.redirectUri, { code, state: request.state });
  }
  async function beginInteraction(
    req: Request,
    res: Response,
    request: AuthorizationRequest,
  ): Promise<void> {
    if (!options.renderInteraction || !options.verifyInteractionRequest)
      throw new Error("interaction hooks are not configured");
    let transaction = "",
      stored = false;
    for (let attempt = 0; attempt < 3 && !stored; attempt++) {
      transaction = makeToken();
      if (!PKCE.test(transaction))
        throw new Error("randomToken returned an invalid transaction id");
      stored = await options.store.putTransaction(
        transaction,
        request,
        transactionTtl * 1_000,
      );
    }
    if (!stored)
      throw new Error("could not allocate a unique authorization transaction");
    setTransactionCookie(res, transaction);
    await options.renderInteraction(req, res, request);
    if (!res.closed)
      throw new Error("renderInteraction must close the response");
  }
  async function oauthBearerAuthentication(
    req: Request<A, C>,
    res: Response,
  ): Promise<void> {
    const config = req.endpointMeta.oauthAuthorizationCode;
    if (config === false || config === undefined) return;
    if (!(await secure(req))) {
      await bearerError(res, "invalid_token", 401);
      return;
    }
    const token = bearer(req);
    if (!token) {
      await bearerError(res, "invalid_token", 401);
      return;
    }
    try {
      const stored = await options.store.getToken(token);
      if (!stored || !validToken(stored) || stored.expiresAt <= now()) {
        await bearerError(res, "invalid_token", 401);
        return;
      }
      const required = config.requiredScopes ?? [];
      if (required.some((scope) => !stored.scopes.includes(scope))) {
        await bearerError(res, "insufficient_scope", 403, required);
        return;
      }
      req.context.user = immutableUser(stored.user);
      req.context.oauth = {
        ...(req.context.oauth ?? {}),
        client: Object.freeze(structuredClone(stored.client)),
      };
    } catch (error) {
      options.onError?.(error);
      await bearerError(res, "invalid_token", 401);
    }
  }
  async function authorizationEndpoint(
    req: Request<A, C>,
    res: Response,
  ): Promise<void> {
    if (!(await secure(req))) {
      await jsonError(res, "invalid_request");
      return;
    }
    let client: ClientRecord | undefined,
      redirectUri: string | undefined,
      state: string | undefined;
    try {
      const clientId = one(req.query.client_id, "client_id")!;
      client = await options.lookupClient(clientId, req);
      if (!validClient(client, clientId)) {
        await jsonError(res, "invalid_request");
        return;
      }
      redirectUri = one(req.query.redirect_uri, "redirect_uri")!;
      if (!client.redirectUris.includes(redirectUri)) {
        await jsonError(res, "invalid_request");
        return;
      }
      state = one(req.query.state, "state", false);
      if (
        state !== undefined &&
        (state.length > 1024 || /[\x00-\x20\x7F]/.test(state))
      )
        throw new InputError("invalid state");
      if (one(req.query.response_type, "response_type") !== "code") {
        await redirect(res, redirectUri, {
          error: "unsupported_response_type",
          state,
        });
        return;
      }
      const challenge = one(req.query.code_challenge, "code_challenge")!;
      if (
        !PKCE.test(challenge) ||
        one(req.query.code_challenge_method, "code_challenge_method") !== "S256"
      ) {
        await redirect(res, redirectUri, { error: "invalid_request", state });
        return;
      }
      const requested = scopes(one(req.query.scope, "scope", false));
      if (requested.some((scope) => !client!.allowedScopes.includes(scope))) {
        await redirect(res, redirectUri, { error: "invalid_scope", state });
        return;
      }
      const request: AuthorizationRequest = {
        client,
        redirectUri,
        requestedScopes: Object.freeze(requested),
        ...(state === undefined ? {} : { state }),
        codeChallenge: challenge,
      };
      const decision = await options.authorize(req, res, request);
      if (decision === undefined) {
        if (!res.closed)
          throw new Error(
            "authorize hook returned without a decision or response",
          );
        return;
      }
      if ("interaction" in decision) {
        await beginInteraction(req, res, request);
        return;
      }
      await finishAuthorization(req, res, request, decision);
    } catch (error) {
      options.onError?.(error);
      if (client && redirectUri && client.redirectUris.includes(redirectUri))
        await redirect(res, redirectUri, {
          error:
            error instanceof InputError ? "invalid_request" : "server_error",
          state,
        });
      else await jsonError(res, "invalid_request");
    }
  }
  async function continuationEndpoint(
    req: Request<A, C>,
    res: Response,
  ): Promise<void> {
    noStore(res);
    if (
      !(await secure(req)) ||
      !options.verifyInteractionRequest ||
      !(await options.verifyInteractionRequest(req))
    ) {
      await jsonError(res, "invalid_request");
      return;
    }
    const transaction = cookieValue(req, transactionCookie);
    if (!transaction) {
      await jsonError(res, "invalid_request");
      return;
    }
    setTransactionCookie(res, "", true);
    try {
      const request = await options.store.consumeTransaction(transaction);
      if (!request) {
        await jsonError(res, "invalid_request");
        return;
      }
      if (!validTransaction(request))
        throw new Error("OAuth store returned an invalid transaction");
      const decision = await options.authorize(req, res, request);
      if (decision === undefined) {
        if (!res.closed)
          throw new Error("authorize hook returned without decision");
        return;
      }
      if ("interaction" in decision)
        throw new Error(
          "continued interaction cannot request another interaction",
        );
      await finishAuthorization(req, res, request, decision);
    } catch (error) {
      options.onError?.(error);
      if (!res.closed) await jsonError(res, "server_error");
    }
  }
  async function tokenEndpoint(
    req: Request<A, C>,
    res: Response,
  ): Promise<void> {
    noStore(res);
    if (!(await secure(req))) {
      await jsonError(res, "invalid_request");
      return;
    }
    try {
      const params = form(req);
      if (formOne(params, "grant_type") !== "authorization_code") {
        await jsonError(res, "unsupported_grant_type");
        return;
      }
      const code = formOne(params, "code")!,
        redirectUri = formOne(params, "redirect_uri")!,
        verifier = formOne(params, "code_verifier")!,
        bodyClient = formOne(params, "client_id", false),
        authenticated = req.context.oauth?.client;
      const effectiveClient = authenticated?.clientId ?? bodyClient;
      if (!effectiveClient) {
        await invalidClient(res);
        return;
      }
      const client = await options.lookupClient(effectiveClient, req);
      if (
        !validClient(client, effectiveClient) ||
        (client.type === "confidential" &&
          authenticated?.clientId !== effectiveClient) ||
        (client.type === "public" && authenticated !== undefined)
      ) {
        await invalidClient(res);
        return;
      }
      const grant = await options.store.consumeCode(code);
      if (!grant) {
        await jsonError(res, "invalid_grant");
        return;
      }
      if (!validCode(grant))
        throw new Error("OAuth store returned an invalid authorization code");
      if (
        effectiveClient !== grant.clientId ||
        client.type !== grant.clientType ||
        redirectUri !== grant.redirectUri ||
        grant.scopes.some((scope) => !client.allowedScopes.includes(scope)) ||
        !pkce(verifier, grant.codeChallenge)
      ) {
        await jsonError(res, "invalid_grant");
        return;
      }
      let accessToken = "",
        stored = false;
      const tokenRecord: StoredToken = {
        client: {
          clientId: grant.clientId,
          scopes: Object.freeze([...grant.scopes]),
        },
        resourceOwner: structuredClone(grant.resourceOwner),
        user: immutableUser(grant.user),
        scopes: Object.freeze([...grant.scopes]),
        expiresAt: now() + accessTtl * 1_000,
      };
      for (let attempt = 0; attempt < 3 && !stored; attempt++) {
        accessToken = makeToken();
        if (!PKCE.test(accessToken))
          throw new Error("randomToken returned invalid opaque token");
        stored = await options.store.putToken(
          accessToken,
          tokenRecord,
          accessTtl * 1_000,
        );
      }
      if (!stored) throw new Error("could not allocate unique access token");
      await res.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: accessTtl,
        scope: grant.scopes.join(" "),
      });
    } catch (error) {
      options.onError?.(error);
      if (!res.closed)
        await jsonError(
          res,
          error instanceof Error && /unsupported_grant_type/.test(error.message)
            ? "unsupported_grant_type"
            : error instanceof InputError
              ? "invalid_request"
              : "server_error",
        );
    }
  }
  app.use(oauthBearerAuthentication);
  app.get(authorizationPath, authorizationEndpoint);
  app.post(continuationPath, continuationEndpoint);
  app.post(
    tokenPath,
    { oauthClientAuthentication: { required: false } } as Partial<A>,
    tokenEndpoint,
  );
  installed.add(app);
  return Object.freeze({ authorizationPath, continuationPath, tokenPath });
}
