# FilamentJS policies

Opinionated, composable policies for
[FilamentJS](https://www.npmjs.com/package/filamentjs). Each package is
independently installable, uses secure defaults, and documents the Filament
lifecycle stages it can and cannot affect.

| Package                                                                                     | Status                 | Description                                                                                                |
| ------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| [`@filamentjs/foundation`](foundation/README.md)                                            | Initial implementation | Shared application-facing user, session, time, lifecycle, and hook types with no production dependencies. |
| [`@filamentjs/redis`](redis/README.md)                                                      | Initial implementation | Optional Redis connection lifecycle and atomic policy adapters.                                            |
| [`@filamentjs/request-logging`](policies/request-logging/README.md)                         | Initial implementation | Concise completion logs from finalized Filament observations.                                              |
| [`@filamentjs/rate-limiting`](policies/rate-limiting/README.md)                             | Initial implementation | Named endpoint buckets with one or more standalone or distributed quotas.                                  |
| [`@filamentjs/idempotency`](policies/idempotency/README.md)                                 | Initial implementation | Safe duplicate suppression and response replay for selected operations.                                    |
| [`@filamentjs/output-format`](policies/output-format/README.md)                             | Initial implementation | `Accept` negotiation for JSON, opt-in JSONP, and YAML.                                                     |
| [`@filamentjs/cache`](policies/cache/README.md)                                             | Initial implementation | Bounded local caching of final response representations.                                                   |
| [`@filamentjs/oauth-authorization-code`](policies/oauth-authorization-code/README.md)       | Initial implementation | Authorization-code flow with S256 PKCE, opaque tokens, and translated application user information.        |
| [`@filamentjs/oauth-client-authentication`](policies/oauth-client-authentication/README.md) | Initial implementation | OAuth-local `client_secret_basic` authentication for marked protocol endpoints.                            |
| [`@filamentjs/proxy`](policies/proxy/README.md)                                             | Initial implementation | Explicit reverse-proxy routes to trusted upstreams.                                                        |
| `@filamentjs/security-headers`                                                              | Deferred               | Named API/browser security-header profiles pending design review.                                          |
| [`@filamentjs/static-resources`](policies/static-resources/README.md)                       | Initial implementation | Multiple static mounts backed by local or injected stores.                                                 |

The living implementation plan is maintained in `PROJECT.md` locally. Package
READMEs are the public source of installation and API guidance.

Install only the policies an application uses, plus their documented peers:

```sh
npm install @filamentjs/request-logging filamentjs
```

Each policy exports a named `setup(app, options?)` function and composable
`AppMeta`/`ContextMeta` types where it contributes metadata. Intersect those
types at `createApp`, call the relevant setup functions, then mark only the
endpoints that need opt-in policies. The package READMEs contain complete typed
examples and the sequencing constraints that actually apply.

## License

ISC
