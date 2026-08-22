import type {
  ContextMeta as FoundationContext,
  UserInfo,
} from "@filamentjs/foundation";
import type { Request, Response } from "filamentjs";
export interface ClientRecord {
  readonly clientId: string;
  readonly type: "public" | "confidential";
  readonly redirectUris: readonly string[];
  readonly allowedScopes: readonly string[];
}
export interface AuthorizationRequest {
  readonly client: ClientRecord;
  readonly redirectUri: string;
  readonly requestedScopes: readonly string[];
  readonly state?: string;
  readonly codeChallenge: string;
}
/** OAuth protocol identity retained only inside this policy and its stores. */
export interface OAuthResourceOwner {
  readonly subject: string;
  readonly claims?: Readonly<Record<string, unknown>>;
}
/** OAuth client identity shared only between the two OAuth policies. */
export interface AuthenticatedOAuthClient {
  readonly clientId: string;
  readonly scopes?: readonly string[];
  readonly claims?: Readonly<Record<string, unknown>>;
}
export type AuthorizationDecision =
  | {
      readonly approved: true;
      readonly resourceOwner: OAuthResourceOwner;
      readonly scopes: readonly string[];
    }
  | { readonly approved: false }
  | { readonly interaction: true }
  | undefined;
export interface StoredCode {
  readonly clientId: string;
  readonly clientType: ClientRecord["type"];
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly resourceOwner: OAuthResourceOwner;
  readonly user: UserInfo;
  readonly codeChallenge: string;
}
export interface StoredToken {
  readonly client: AuthenticatedOAuthClient;
  readonly resourceOwner: OAuthResourceOwner;
  readonly user: UserInfo;
  readonly scopes: readonly string[];
  readonly expiresAt: number;
}
export interface OAuthStore {
  putTransaction(
    id: string,
    request: AuthorizationRequest,
    ttlMs: number,
  ): Promise<boolean>;
  consumeTransaction(id: string): Promise<AuthorizationRequest | undefined>;
  putCode(code: string, record: StoredCode, ttlMs: number): Promise<boolean>;
  consumeCode(code: string): Promise<StoredCode | undefined>;
  putToken(token: string, record: StoredToken, ttlMs: number): Promise<boolean>;
  getToken(token: string): Promise<StoredToken | undefined>;
  close(): void | Promise<void>;
}
export interface AppMeta {
  readonly oauthAuthorizationCode?:
    | false
    | { readonly requiredScopes?: readonly string[] };
  readonly oauthClientAuthentication?: false | { readonly required?: boolean };
}
interface OAuthContextMeta {
  oauth?: {
    client?: AuthenticatedOAuthClient;
  };
}
export type ContextMeta = FoundationContext & OAuthContextMeta;
export interface SetupOptions {
  readonly store: OAuthStore;
  readonly lookupClient: (
    clientId: string,
    req: Request,
  ) => ClientRecord | undefined | Promise<ClientRecord | undefined>;
  readonly authorize: (
    req: Request,
    res: Response,
    request: AuthorizationRequest,
  ) => AuthorizationDecision | Promise<AuthorizationDecision>;
  readonly mapUser?: (
    resourceOwner: OAuthResourceOwner,
    grantedScopes: readonly string[],
    req: Request,
  ) => UserInfo | Promise<UserInfo>;
  readonly renderInteraction?: (
    req: Request,
    res: Response,
    request: AuthorizationRequest,
  ) => void | Promise<void>;
  readonly verifyInteractionRequest?: (
    req: Request,
  ) => boolean | Promise<boolean>;
  readonly basePath?: string;
  readonly codeTtlSeconds?: number;
  readonly transactionTtlSeconds?: number;
  readonly accessTokenTtlSeconds?: number;
  readonly randomToken?: () => string;
  readonly now?: () => number;
  readonly assertSecureTransport?: (req: Request) => boolean | Promise<boolean>;
  readonly allowInsecureDevelopment?: boolean;
  readonly onError?: (error: unknown) => void;
}
export interface SetupResult {
  readonly authorizationPath: string;
  readonly continuationPath: string;
  readonly tokenPath: string;
}
