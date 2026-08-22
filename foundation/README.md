# `@filamentjs/foundation`

Shared application-facing user information, lifecycle, clock, entropy, and hook
types for independently installable FilamentJS policies. Protocol details such
as OAuth subjects, scopes, claims, clients, and tokens deliberately stay in
their owning policy packages.

## Key features

- Shared username, realm, email, culturally neutral name, role, and session contracts.
- Composable `AppMeta` and `ContextMeta` contributions.
- Small clock, entropy, lifecycle, and async-hook contracts for policy authors.
- Exact role helpers and runtime validation of the shared user boundary.
- Zero external production dependencies and no mutable global state.

## Quick start

```sh
npm install @filamentjs/foundation
```

Initial compatibility: Node.js 24 LTS. Foundation does not import Filament at
runtime and is versioned independently from `filamentjs`.

```ts
import type { ContextMeta as FilamentContextMeta } from "filamentjs";
import {
  hasRole,
  type ContextMeta as FoundationContextMeta,
  type UserInfo,
} from "@filamentjs/foundation";

type Context = FilamentContextMeta & FoundationContextMeta;

const user: UserInfo = {
  id: "user-123",
  username: "alice",
  realm: "employees",
  emailAddress: "alice@example.com",
  fullName: "Alice Example",
  shortName: "Alice",
  roles: ["invoice-reader"],
};

const context: Context = {
  user,
};

hasRole(user, "invoice-reader"); // true
```

## How it works and options

Foundation contributes only the root `user` and `session` context keys. Policies
place translated user information or minimal session information there. They
must not expose their own subjects, scopes, claims, tokens, or protocol clients
through these shared fields. Applications can extend the user/profile shape
through their own intersections.

`fullName` stores the complete name in the form supplied by the user. `shortName`
stores a separately supplied familiar or display form—it must not be inferred by
splitting or reordering `fullName`. This avoids imposing one culture's naming
structure, following [W3C guidance on personal names](https://www.w3.org/International/questions/qa-personal-names).
`roles` is mutable in the TypeScript interface. A policy publishing `UserInfo`
to request context must deeply freeze the user value at that boundary.

### Exports

- `UserInfo` and `SessionInfo`
- composable `AppMeta` and `ContextMeta` contributions
- `Clock`, `EntropySource`, `AsyncCloseable`, and `MaybePromise`
- `systemClock`, `isUserInfo()`, and `hasRole()`

Role names are exact and case-sensitive. `isUserInfo()` validates the shared
fields only; it does not impose application-specific profile rules.

The earlier unpublished draft names `Principal`, `OAuthClientPrincipal`,
`SessionIdentity`, `isPrincipal()`, and `hasScope()` were intentionally removed
without aliases. Migrate to `UserInfo`, `SessionInfo`, `isUserInfo()`, and
`hasRole()`; OAuth client/resource-owner records now belong to the OAuth
packages.

## Development and demo

From a source checkout:

```sh
npm test
npm run example
npm run demo
```

Tests use `node:test`. The unattended demo validates user information, shows
name fields and exact role matching, prints each step, and exits without a
server.

There is no pre-0.1 migration contract.

## License

ISC
