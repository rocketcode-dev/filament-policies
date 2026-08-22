import { hasRole, type ContextMeta, type UserInfo } from "../foundation.js";

// Foundation defines the small identity shape shared by independently
// installed policies. It contains programmer-facing user information rather
// than the subjects, claims, or scopes used inside an authentication protocol.
const user: UserInfo = {
  id: "user-123",
  username: "alice",
  realm: "employees",
  emailAddress: "alice@example.com",
  emailVerified: true,
  fullName: "Alice Example",
  shortName: "Alice",
  roles: ["profile-reader"],
};

// Policies exchange shared user and session facts directly on the request
// context. A policy that authenticates the request writes here;
// authorization-aware policies can then read it.
const context: ContextMeta = {
  user,
};

// Role matching is deliberately exact and case-sensitive. This helper is
// useful in application hooks, but it does not replace business authorization.
console.log({
  username: context.user?.username,
  email: context.user?.emailAddress,
  canReadProfile: hasRole(user, "profile-reader"),
});
