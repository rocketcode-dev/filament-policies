import { createHash } from "node:crypto";
import type { RedisConnection } from "./connection.js";
import { createRedisKeyspace, type RedisKeyspace } from "./keyspace.js";
export interface RedisOAuthCode {
  readonly clientId: string;
  readonly clientType: "public" | "confidential";
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly resourceOwner: {
    readonly subject: string;
    readonly claims?: Readonly<Record<string, unknown>>;
  };
  readonly user: RedisUserInfo;
  readonly codeChallenge: string;
}
export interface RedisUserInfo {
  readonly username: string;
  readonly realm?: string;
  readonly id?: string;
  readonly emailAddress?: string;
  readonly emailVerified?: boolean;
  readonly fullName?: string;
  readonly shortName?: string;
  roles?: string[];
}
export interface RedisOAuthToken {
  readonly client: {
    readonly clientId: string;
    readonly scopes?: readonly string[];
    readonly claims?: Readonly<Record<string, unknown>>;
  };
  readonly resourceOwner: RedisOAuthCode["resourceOwner"];
  readonly user: RedisUserInfo;
  readonly scopes: readonly string[];
  readonly expiresAt: number;
}
export interface RedisOAuthTransaction {
  readonly client: {
    readonly clientId: string;
    readonly type: "public" | "confidential";
    readonly redirectUris: readonly string[];
    readonly allowedScopes: readonly string[];
  };
  readonly redirectUri: string;
  readonly requestedScopes: readonly string[];
  readonly state?: string;
  readonly codeChallenge: string;
}
export interface RedisOAuthStore {
  putTransaction(
    id: string,
    request: RedisOAuthTransaction,
    ttlMs: number,
  ): Promise<boolean>;
  consumeTransaction(id: string): Promise<RedisOAuthTransaction | undefined>;
  putCode(
    code: string,
    record: RedisOAuthCode,
    ttlMs: number,
  ): Promise<boolean>;
  consumeCode(code: string): Promise<RedisOAuthCode | undefined>;
  putToken(
    token: string,
    record: RedisOAuthToken,
    ttlMs: number,
  ): Promise<boolean>;
  getToken(token: string): Promise<RedisOAuthToken | undefined>;
  close(): void;
}
export interface RedisOAuthStoreOptions {
  readonly keyspace?: RedisKeyspace;
  readonly maxRecordBytes?: number;
}
const PUT = `if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]) return 1`;
const CONSUME = `local value = redis.call('GET', KEYS[1]) if not value then return false end redis.call('DEL', KEYS[1]) return value`;
const GET = `return redis.call('GET', KEYS[1])`;
function hash(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}
type Kind = "transaction" | "code" | "token";
const PKCE = /^[A-Za-z0-9._~-]{43,128}$/;
const SCOPE = /^[\x21\x23-\x5B\x5D-\x7E]+$/;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function validScopes(value: unknown): value is string[] {
  return strings(value) && value.every((item) => SCOPE.test(item));
}
function validClaims(value: unknown): boolean {
  return value === undefined || record(value);
}
function validResourceOwner(value: unknown): boolean {
  return (
    record(value) &&
    typeof value.subject === "string" &&
    value.subject.length > 0 &&
    validClaims(value.claims)
  );
}
function validOAuthClient(value: unknown): boolean {
  return (
    record(value) &&
    typeof value.clientId === "string" &&
    value.clientId.length > 0 &&
    (value.scopes === undefined || validScopes(value.scopes)) &&
    validClaims(value.claims)
  );
}
function optionalText(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length > 0);
}
function validUser(value: unknown): boolean {
  if (
    !record(value) ||
    typeof value.username !== "string" ||
    value.username.length === 0 ||
    !optionalText(value.realm) ||
    !optionalText(value.id) ||
    !optionalText(value.emailAddress) ||
    !optionalText(value.fullName) ||
    !optionalText(value.shortName) ||
    (value.emailVerified !== undefined &&
      typeof value.emailVerified !== "boolean") ||
    (value.roles !== undefined &&
      (!strings(value.roles) ||
        value.roles.some((role) => role.length === 0) ||
        new Set(value.roles).size !== value.roles.length))
  )
    return false;
  return true;
}
function validValue(kind: Kind, value: unknown): boolean {
  if (!record(value)) return false;
  if (kind === "transaction") {
    const client = value.client;
    if (!record(client)) return false;
    const redirectUris = client.redirectUris;
    const allowedScopes = client.allowedScopes;
    const requestedScopes = value.requestedScopes;
    return (
      typeof client.clientId === "string" &&
      client.clientId.length > 0 &&
      (client.type === "public" || client.type === "confidential") &&
      strings(redirectUris) &&
      redirectUris.length > 0 &&
      validScopes(allowedScopes) &&
      typeof value.redirectUri === "string" &&
      redirectUris.includes(value.redirectUri) &&
      validScopes(requestedScopes) &&
      requestedScopes.every((scope) => allowedScopes.includes(scope)) &&
      (value.state === undefined || typeof value.state === "string") &&
      typeof value.codeChallenge === "string" &&
      PKCE.test(value.codeChallenge)
    );
  }
  if (kind === "code")
    return (
      typeof value.clientId === "string" &&
      value.clientId.length > 0 &&
      (value.clientType === "public" || value.clientType === "confidential") &&
      typeof value.redirectUri === "string" &&
      value.redirectUri.length > 0 &&
      validScopes(value.scopes) &&
      validResourceOwner(value.resourceOwner) &&
      validUser(value.user) &&
      typeof value.codeChallenge === "string" &&
      PKCE.test(value.codeChallenge)
    );
  return (
    validOAuthClient(value.client) &&
    validResourceOwner(value.resourceOwner) &&
    validUser(value.user) &&
    validScopes(value.scopes) &&
    typeof value.expiresAt === "number" &&
    Number.isFinite(value.expiresAt)
  );
}
function key(keyspace: RedisKeyspace, kind: Kind, secret: string): string {
  return keyspace.key("oauth", kind, hash(secret));
}
function ttl(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError("OAuth ttlMs must be positive");
  return String(value);
}
function serialize(
  kind: Kind,
  value: RedisOAuthTransaction | RedisOAuthCode | RedisOAuthToken,
  maximum: number,
): string {
  const text = JSON.stringify({ v: 2, kind, value });
  if (Buffer.byteLength(text) > maximum)
    throw new RangeError("OAuth record exceeds maxRecordBytes");
  return text;
}
function parse<T>(raw: unknown, kind: Kind, maximum: number): T | undefined {
  if (raw === null || raw === undefined || raw === false) return undefined;
  if (typeof raw !== "string" || Buffer.byteLength(raw) > maximum)
    throw new Error("Invalid Redis OAuth record reply");
  const envelope: unknown = JSON.parse(raw);
  if (!envelope || typeof envelope !== "object")
    throw new Error("Invalid Redis OAuth record reply");
  const item = envelope as Record<string, unknown>;
  if (
    item.v !== 2 ||
    item.kind !== kind ||
    !validValue(kind, item.value)
  )
    throw new Error("Invalid Redis OAuth record reply");
  return item.value as T;
}
export function createRedisOAuthStore(
  connection: RedisConnection,
  options: RedisOAuthStoreOptions = {},
): RedisOAuthStore {
  const keyspace = options.keyspace ?? createRedisKeyspace(),
    maximum = options.maxRecordBytes ?? 64 * 1024;
  if (!Number.isSafeInteger(maximum) || maximum < 1)
    throw new RangeError("maxRecordBytes must be positive");
  async function put(
    kind: Kind,
    secret: string,
    value: RedisOAuthTransaction | RedisOAuthCode | RedisOAuthToken,
    ttlMs: number,
  ): Promise<boolean> {
    await connection.open();
    const reply = await connection.client.eval(PUT, {
      keys: [key(keyspace, kind, secret)],
      arguments: [serialize(kind, value, maximum), ttl(ttlMs)],
    });
    if (reply === 1) return true;
    if (reply === 0) return false;
    throw new Error("Invalid Redis OAuth put reply");
  }
  async function consume<T>(
    kind: Kind,
    secret: string,
  ): Promise<T | undefined> {
    await connection.open();
    return parse<T>(
      await connection.client.eval(CONSUME, {
        keys: [key(keyspace, kind, secret)],
        arguments: [],
      }),
      kind,
      maximum,
    );
  }
  return {
    putTransaction: (id, request, ttlMs) =>
      put("transaction", id, request, ttlMs),
    consumeTransaction: (id) =>
      consume<RedisOAuthTransaction>("transaction", id),
    putCode: (code, record, ttlMs) => put("code", code, record, ttlMs),
    consumeCode: (code) => consume<RedisOAuthCode>("code", code),
    putToken: (token, record, ttlMs) => put("token", token, record, ttlMs),
    async getToken(token) {
      await connection.open();
      return parse<RedisOAuthToken>(
        await connection.client.eval(GET, {
          keys: [key(keyspace, "token", token)],
          arguments: [],
        }),
        "token",
        maximum,
      );
    },
    close() {},
  };
}
