import { timingSafeEqual } from "node:crypto";
import {
  createApp,
  type ContextMeta as BaseContext,
  type FrameworkMeta,
} from "filamentjs";
import {
  setup,
  type AppMeta,
  type ContextMeta,
} from "../oauth-client-authentication.js";
const app = createApp<FrameworkMeta & AppMeta, BaseContext & ContextMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);
setup(app, {
  allowInsecureDevelopment: true,
  authenticate: (id, secret) => {
    const expected = Buffer.from("demo-secret"),
      actual = Buffer.from(secret);
    return id === "demo" &&
      actual.length === expected.length &&
      timingSafeEqual(actual, expected)
      ? { clientId: id }
      : undefined;
  },
});
app.post("/token", { oauthClientAuthentication: {} }, async (req, res) =>
  res.json({
    clientId: req.context.oauth?.client?.clientId,
  }),
);
const port = await app.listen(0);
const url = `http://127.0.0.1:${port}/token`;
console.log("\n@filamentjs/oauth-client-authentication — live walkthrough");
console.log("============================================================");
console.log("This demo uses HTTP only through the explicit development escape hatch.");
try {
  console.log("1. Valid client_secret_basic credentials expose client identity.");
  const valid = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from("demo:demo-secret").toString("base64")}` },
  });
  console.log(`   HTTP ${valid.status}: ${await valid.text()}`);

  console.log("2. Invalid credentials return the generic OAuth error.");
  const invalid = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from("demo:wrong").toString("base64")}` },
  });
  console.log(`   HTTP ${invalid.status}; WWW-Authenticate ${invalid.headers.get("www-authenticate")}`);
  console.log(`   body: ${await invalid.text()}`);
} finally {
  await app.close();
}
console.log("\nDemo complete; the server closed cleanly.\n");
