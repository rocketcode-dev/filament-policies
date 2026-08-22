import type { Request } from "filamentjs";
export interface AuthenticatedOAuthClient {
  readonly clientId: string;
  readonly scopes?: readonly string[];
  readonly claims?: Readonly<Record<string, unknown>>;
}
export interface EndpointOptions {
  readonly required?: boolean;
}
export interface AppMeta {
  readonly oauthClientAuthentication?: false | EndpointOptions;
}
export interface ContextMeta {
  oauth?: {
    client?: AuthenticatedOAuthClient;
  };
}
export interface SetupOptions {
  readonly authenticate: (
    clientId: string,
    secret: string,
    req: Request,
  ) =>
    | AuthenticatedOAuthClient
    | undefined
    | Promise<AuthenticatedOAuthClient | undefined>;
  readonly assertSecureTransport?: (req: Request) => boolean | Promise<boolean>;
  readonly allowInsecureDevelopment?: boolean;
  readonly realm?: string;
  readonly maxCredentialBytes?: number;
  readonly onError?: (error: unknown) => void;
}
