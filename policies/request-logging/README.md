# `@filamentjs/request-logging`

Emits one concise completion record from Filament's finalized observation. It
uses a finalizer, so it sees successful and failed matched requests after the
response has been committed and cannot alter the response.

## Key features

- One structured completion record and injection-safe default line per request.
- Successful, error, streaming, buffered, terminal-middleware, and 404 coverage
  when Filament retains the necessary observation fields.
- Endpoint opt-out plus explicit skip and callback-failure hooks.
- Pluggable synchronous or asynchronous sinks without a logging dependency.
- Query strings, headers, bodies, and thrown callback values omitted by default.

## Quick start

```sh
npm install @filamentjs/request-logging filamentjs
```

Initial compatibility: Node.js 24 LTS and exactly `filamentjs@0.6.0` while
Filament remains pre-1.0.

```ts
import { createApp, type FrameworkMeta } from "filamentjs";
import * as requestLogging from "@filamentjs/request-logging";

type AppMeta = FrameworkMeta & requestLogging.AppMeta;

const app = createApp<AppMeta>(
  {
    application: {
      maxRequestSize: "1MiB",
      observability: { enabled: true },
    },
  },
  {},
);

requestLogging.setup(app);

app.get("/hello", async (_req, res) => {
  await res.json({ hello: "world" });
});
```

## How it works and options

The default line is:

```text
[request-id] METHOD PATH - STATUS MODE LATENCYms
```

The request ID already contains a UTC timestamp. The default formatter escapes
control characters so an untrusted path cannot inject another log line. Query
strings, headers, and bodies are not logged.

### Endpoint metadata

| Field                    | Default | Meaning                             |
| ------------------------ | ------- | ----------------------------------- |
| `requestLogging`         | enabled | Set to `false` to skip an endpoint. |
| `requestLogging.enabled` | `true`  | Set to `false` to skip an endpoint. |

Filament must retain observed method and path for the final status. When
observability is disabled or pruning removes either field, the policy emits no
partial line. `onSkip` can diagnose that configuration.

### Setup options

- `sink(record, formattedLine)` receives a frozen, structured record and the
  formatted line. It may be synchronous or asynchronous.
- `formatter(record)` replaces the default one-line formatter.
- `now()` supplies epoch milliseconds for deterministic tests.
- `onSkip(reason)` observes intentionally skipped logs.
- `onError(error, stage)` observes formatter, sink, or diagnostic callback
  failures.

The default sink calls `console.log`. Callback failures are contained because
the response is already committed; the default error report deliberately omits
the thrown value in case a transport error contains credentials.

Custom formatters and sinks receive untrusted path text and must preserve
redaction and log-injection safety themselves.

### Lifecycle and composition

- Stage: finalizer.
- Registering twice on one application throws before the second finalizer is
  installed.
- Finalizer order controls whether logged latency includes earlier finalizer
  work.
- The policy does not need a transformer and does not change buffering.
- It can observe streaming, buffered, terminal-middleware, route-error, and 404
  completion only to the extent Filament's final observation retains method and
  path. Unmatched routes use default application metadata.
- Sink failure cannot change the response and does not stop later finalizers.

## Development and demo

From a source checkout:

```sh
npm test
npm run example
npm run demo
```

The unattended demo starts a real Filament server, calls a logged endpoint and
an endpoint that opts out, prints the live responses/log evidence, closes the
server, and exits. Tests use the local Filament source configured by the root
`filament.yaml`; set `FILAMENTJS_SOURCE` to override that checkout.

## License

ISC
