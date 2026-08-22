/** A value or a promise for that value, for hooks that may be synchronous. */
export type MaybePromise<T> = T | Promise<T>;

/** Application metadata contribution. Foundation defines no endpoint rules. */
export interface AppMeta {}

/** A testable source of epoch milliseconds. */
export interface Clock {
  now(): number;
}

/** A source of cryptographically secure random bytes in production. */
export interface EntropySource {
  bytes(length: number): Uint8Array;
}

/** A resource with explicit asynchronous or synchronous cleanup. */
export interface AsyncCloseable {
  close(): MaybePromise<void>;
}

/**
 * Application-facing information about the authenticated user.
 *
 * This deliberately contains no OAuth subjects, scopes, claims, clients, or
 * tokens. Authentication policies translate their protocol-specific records
 * into this shared shape before exposing them to other policies.
 */
export interface UserInfo {
  readonly username: string;
  readonly realm?: string;
  readonly id?: string;
  readonly emailAddress?: string;
  readonly emailVerified?: boolean;
  readonly fullName?: string;
  readonly shortName?: string;
  roles?: string[];
}

/**
 * Minimal shared session facts. Session payloads and storage remain owned by
 * the application or the policy that establishes the session.
 */
export interface SessionInfo {
  readonly id: string;
  readonly authenticatedAt?: number;
  readonly expiresAt?: number;
}

/** Request-context contribution exported for application intersections. */
export interface ContextMeta {
  user?: UserInfo;
  session?: SessionInfo;
}
