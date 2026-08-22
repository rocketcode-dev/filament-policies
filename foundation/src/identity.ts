import type { UserInfo } from "./types.js";

const USER_TEXT_FIELDS = [
  "realm",
  "id",
  "emailAddress",
  "fullName",
  "shortName",
] as const satisfies readonly (keyof UserInfo)[];

/** Safely identifies the shared application-facing user shape. */
export function isUserInfo(value: unknown): value is UserInfo {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<UserInfo>;
  if (
    typeof candidate.username !== "string" ||
    candidate.username.length === 0
  ) {
    return false;
  }
  if (
    USER_TEXT_FIELDS.some(
      (field) =>
        candidate[field] !== undefined &&
        (typeof candidate[field] !== "string" || candidate[field].length === 0),
    ) ||
    (candidate.emailVerified !== undefined &&
      typeof candidate.emailVerified !== "boolean")
  ) {
    return false;
  }
  if (candidate.roles !== undefined) {
    if (!Array.isArray(candidate.roles)) return false;
    if (
      candidate.roles.some(
        (role) => typeof role !== "string" || role.length === 0,
      ) ||
      new Set(candidate.roles).size !== candidate.roles.length
    )
      return false;
  }
  return true;
}

/** Checks an exact, case-sensitive application role. */
export function hasRole(
  user: Pick<UserInfo, "roles">,
  requiredRole: string,
): boolean {
  return (
    requiredRole.length > 0 && user.roles?.includes(requiredRole) === true
  );
}
