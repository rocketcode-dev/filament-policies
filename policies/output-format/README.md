# @filamentjs/output-format

Negotiate explicit JSON responses as JSON or YAML, with conservative opt-in
JSONP support. The policy handles media ranges and quality values before a
buffered transformer serializes the selected representation.

## Key features

- Correct `Accept` quality, specificity, wildcard, and exclusion handling.
- JSON and deterministic YAML by default; JSONP only by explicit opt-in.
- `Vary: Accept`, 406 stopping behavior, and bounded callback grammar.
- Transforms only explicitly JSON/`+json` buffered route responses.
- Leaves arbitrary text, binary, streaming, middleware-owned, and error
  responses untouched.

## Quick start

```sh
npm install @filamentjs/output-format filamentjs
```

```ts
import { createApp, type ContextMeta as BaseContext, type FrameworkMeta } from "filamentjs";
import { setup, type AppMeta, type ContextMeta } from "@filamentjs/output-format";

const app = createApp<FrameworkMeta & AppMeta, BaseContext & ContextMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);
setup(app, { allowed: ["json", "yaml"], default: "json" });
app.get("/profile", async (_req, res) => res.json({ id: 1 }));
```

Requires Node 24+ and the exact supported peer `filamentjs@0.6.0`.

## How it works and options

The policy parses `Accept` quality values, wildcards, and exclusions, returns
406 when no allowed representation matches, and adds `Vary: Accept`. YAML uses
the focused `yaml` codec with aliases disabled and stable key ordering. XML and
TOML are deferred pending a dependency and representation review.

JSONP is GET-only, requires a valid callback query value (default parameter
`callback`), uses a conservative dotted JavaScript identifier grammar, escapes
script-relevant characters, and returns `nosniff`.

Only buffered route responses with an explicit `application/json` or `+json`
content type are transformed. Arbitrary text and binary data are never parsed.
Middleware-owned, streaming, and error responses bypass Filament transformers.
Registering this transformer makes buffering the Filament default; set
`res.streaming = true` on routes that intentionally stream.

### Public API

| Surface | Meaning |
| --- | --- |
| `setup(app, options?)` | Registers negotiation middleware and a buffered transformer once. |
| `negotiate(accept, allowed, fallback)` | Pure media-range selection helper. |
| `Format` | `"json"`, `"yaml"`, or opt-in `"jsonp"`. |
| `AppMeta.outputFormat` | `false`, or endpoint enablement, allowed/default formats, and callback parameter. |
| `ContextMeta.outputFormat` | Selected format and validated JSONP callback. |

Negotiation middleware can stop with 400 or 406 before the route. Codec errors
enter Filament's error flow without reflecting the payload. Register this
before cache or idempotency so their later transformers capture final bytes.
YAML is the only production dependency; XML/TOML remain intentionally absent.

## Development and demo

From a source checkout:

```sh
npm test
npm run example
npm run demo
```

The unattended demo starts a server and prints live JSON, YAML, JSONP, and
unsupported-XML negotiations before closing and exiting. There is no pre-0.1
migration contract.

## License

ISC
