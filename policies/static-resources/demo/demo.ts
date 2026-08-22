import { createApp, type FrameworkMeta } from "filamentjs";
import { setup, type ResourceStore } from "../static-resources.js";

const body = Buffer.from("FilamentJS static resources demo\n");
const store: ResourceStore = {
  async list() {
    return [
      {
        key: "hello.txt",
        byteLength: body.length,
        contentType: "text/plain; charset=utf-8",
        etag: '"demo-v1"',
      },
    ];
  },
  async metadata() {
    return {
      key: "hello.txt",
      byteLength: body.length,
      contentType: "text/plain; charset=utf-8",
      etag: '"demo-v1"',
    };
  },
  async read() {
    return body;
  },
};
const app = createApp<FrameworkMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);
await setup(app, { mounts: [{ path: "/files", store, refresh: "never" }] });
const port = await app.listen(0);
const url = `http://127.0.0.1:${port}/files/hello.txt`;
console.log("\n@filamentjs/static-resources — live walkthrough");
console.log("=================================================");
try {
  console.log("1. GET a resource from an injected in-memory store.");
  const get = await fetch(url);
  console.log(`   HTTP ${get.status}; ETag ${get.headers.get("etag")}`);
  console.log(`   body: ${JSON.stringify(await get.text())}`);

  console.log("2. Repeat conditionally with If-None-Match.");
  const conditional = await fetch(url, {
    headers: { "If-None-Match": '"demo-v1"' },
  });
  console.log(`   HTTP ${conditional.status}; body bytes: ${(await conditional.arrayBuffer()).byteLength}`);

  console.log("3. HEAD returns metadata without representation bytes.");
  const head = await fetch(url, { method: "HEAD" });
  console.log(`   HTTP ${head.status}; Content-Length ${head.headers.get("content-length")}; body bytes: ${(await head.arrayBuffer()).byteLength}`);
} finally {
  await app.close();
}
console.log("\nDemo complete; the server closed cleanly.\n");
