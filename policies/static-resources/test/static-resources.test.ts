import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp, type FrameworkMeta } from "filamentjs";
import {
  createFileSystemStore,
  parseRefreshInterval,
  setup,
  type ResourceMetadata,
  type ResourceStore,
} from "../static-resources.js";

class MemoryStore implements ResourceStore {
  readonly resources = new Map<
    string,
    { body: Buffer; metadata: ResourceMetadata }
  >();
  metadataReads = 0;
  bodyReads = 0;

  set(
    key: string,
    body: string,
    modified = new Date("2026-01-01T00:00:00Z"),
    etag = '"v1"',
  ): void {
    const bytes = Buffer.from(body);
    this.resources.set(key, {
      body: bytes,
      metadata: {
        key,
        byteLength: bytes.byteLength,
        lastModified: modified,
        contentType: "text/plain; charset=utf-8",
        etag,
      },
    });
  }
  async list(): Promise<readonly ResourceMetadata[]> {
    return [...this.resources.values()].map(({ metadata }) => ({
      ...metadata,
    }));
  }
  async metadata(key: string): Promise<ResourceMetadata | undefined> {
    this.metadataReads++;
    const value = this.resources.get(key)?.metadata;
    return value === undefined ? undefined : { ...value };
  }
  async read(key: string): Promise<Buffer> {
    this.bodyReads++;
    const value = this.resources.get(key);
    if (value === undefined) throw new Error("missing");
    return Buffer.from(value.body);
  }
}

function app() {
  return createApp<FrameworkMeta>(
    { application: { maxRequestSize: "1MiB" } },
    {},
  );
}

test("refresh syntax covers numeric seconds and duration strings", () => {
  assert.equal(parseRefreshInterval(600), 600_000);
  assert.equal(parseRefreshInterval("600s"), 600_000);
  assert.equal(parseRefreshInterval("10m"), 600_000);
  assert.equal(parseRefreshInterval("1h"), 3_600_000);
  assert.equal(parseRefreshInterval("always"), 0);
  assert.equal(parseRefreshInterval("never"), Infinity);
  assert.throws(() => parseRefreshInterval(-1), /non-negative/);
  assert.throws(() => parseRefreshInterval("1d" as never), /refresh/);
});

test("serves two mounts, nested keys, GET, and HEAD", async (t) => {
  const images = new MemoryStore();
  images.set("icons/logo.txt", "logo");
  const scripts = new MemoryStore();
  scripts.set("app.js", "script");
  const server = app();
  const result = await setup(server, {
    mounts: [
      { path: "/images", store: images, refresh: "never" },
      { path: "/js", store: scripts, refresh: "never" },
    ],
  });
  assert.deepEqual(result.routes, ["/images/icons/logo.txt", "/js/app.js"]);
  const port = await server.listen(0);
  t.after(() => server.close());

  const get = await fetch(`http://127.0.0.1:${port}/images/icons/logo.txt`);
  assert.equal(get.status, 200);
  assert.equal(await get.text(), "logo");
  assert.equal(get.headers.get("x-content-type-options"), "nosniff");
  const head = await fetch(`http://127.0.0.1:${port}/js/app.js`, {
    method: "HEAD",
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "6");
  assert.equal(await head.text(), "");
  assert.equal(scripts.bodyReads, 0);
});

test("If-None-Match takes precedence over If-Modified-Since", async (t) => {
  const store = new MemoryStore();
  store.set("asset.txt", "new", new Date("2026-01-02T00:00:00Z"), '"new"');
  const server = app();
  await setup(server, {
    mounts: [{ path: "/files", store, refresh: "never" }],
  });
  const port = await server.listen(0);
  t.after(() => server.close());

  const matched = await fetch(`http://127.0.0.1:${port}/files/asset.txt`, {
    headers: { "If-None-Match": 'W/"new"' },
  });
  assert.equal(matched.status, 304);
  assert.equal(store.bodyReads, 0);
  const precedence = await fetch(`http://127.0.0.1:${port}/files/asset.txt`, {
    headers: {
      "If-None-Match": '"old"',
      "If-Modified-Since": "Sat, 03 Jan 2026 00:00:00 GMT",
    },
  });
  assert.equal(precedence.status, 200);
  assert.equal(await precedence.text(), "new");
});

test("refresh throttles metadata and detects changed content", async (t) => {
  let time = 1_000;
  const store = new MemoryStore();
  store.set("value.txt", "one");
  const server = app();
  await setup(server, {
    mounts: [{ path: "/data", store, refresh: 10 }],
    now: () => time,
  });
  const port = await server.listen(0);
  t.after(() => server.close());
  assert.equal(
    await (await fetch(`http://127.0.0.1:${port}/data/value.txt`)).text(),
    "one",
  );
  assert.equal(store.metadataReads, 0);
  store.set("value.txt", "two", new Date("2026-01-01T00:00:01Z"), '"v2"');
  time += 9_000;
  assert.equal(
    await (await fetch(`http://127.0.0.1:${port}/data/value.txt`)).text(),
    "two",
  );
  assert.equal(store.metadataReads, 0);
  time += 1_000;
  assert.equal(
    await (await fetch(`http://127.0.0.1:${port}/data/value.txt`)).text(),
    "two",
  );
  assert.equal(store.metadataReads, 1);
  store.resources.delete("value.txt");
  time += 10_000;
  assert.equal(
    (await fetch(`http://127.0.0.1:${port}/data/value.txt`)).status,
    404,
  );
  assert.equal(
    (await fetch(`http://127.0.0.1:${port}/data/value.txt`)).status,
    404,
  );
  assert.equal(store.metadataReads, 2);
});

test("rejects traversal, dotfiles, route collisions, and duplicate setup", async () => {
  const unsafe = new MemoryStore();
  unsafe.set("../secret", "no");
  await assert.rejects(
    setup(app(), { mounts: [{ path: "/x", store: unsafe }] }),
    /Unsafe/,
  );
  const dot = new MemoryStore();
  dot.set(".env", "no");
  await assert.rejects(
    setup(app(), { mounts: [{ path: "/x", store: dot }] }),
    /Unsafe/,
  );
  const first = new MemoryStore();
  first.set("same", "a");
  const second = new MemoryStore();
  second.set("same", "b");
  await assert.rejects(
    setup(app(), {
      mounts: [
        { path: "/x", store: first },
        { path: "/x", store: second },
      ],
    }),
    /collision/,
  );
  const server = app();
  await setup(server, { mounts: [{ path: "/x", store: first }] });
  await assert.rejects(
    setup(server, { mounts: [{ path: "/y", store: second }] }),
    /already installed/,
  );
});

test("store failures return a generic 503 and invoke the error hook", async (t) => {
  const store = new MemoryStore();
  store.set("asset", "data");
  store.read = async () => {
    throw new Error("private /bucket/path");
  };
  const seen: Error[] = [];
  const server = app();
  await setup(server, {
    mounts: [{ path: "/x", store, refresh: "never" }],
    onError: (error) => seen.push(error),
  });
  const port = await server.listen(0);
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${port}/x/asset`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("etag"), null);
  assert.equal(response.headers.get("cache-control"), null);
  assert.equal(await response.text(), "Static resource unavailable");
  assert.equal(seen[0]?.message, "private /bucket/path");
});

test("invalid refreshed metadata fails closed without stale validators", async (t) => {
  let now = 0;
  const body = Buffer.from("safe");
  const metadata = {
    key: "value.txt",
    byteLength: body.length,
    etag: '"safe"',
  };
  const server = app();
  await setup(server, {
    now: () => now,
    onError: () => {},
    mounts: [
      {
        path: "/files",
        refresh: "always",
        store: {
          async list() {
            return [metadata];
          },
          async metadata() {
            return { ...metadata, key: "different.txt" };
          },
          async read() {
            return body;
          },
        },
      },
    ],
  });
  const port = await server.listen(0);
  t.after(() => server.close());
  now = 1;
  const response = await fetch(`http://127.0.0.1:${port}/files/value.txt`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("etag"), null);
});

test("filesystem store enumerates nested files and denies dotfiles and symlink escape", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "filament-static-"));
  const root = join(parent, "public");
  await mkdir(join(root, "nested"), { recursive: true });
  await writeFile(join(root, "nested", "app.js"), "export {};");
  await writeFile(join(root, ".secret"), "private");
  await writeFile(join(parent, "outside.txt"), "outside");
  await symlink(join(parent, "outside.txt"), join(root, "escape.txt"));
  t.after(() => rm(parent, { recursive: true, force: true }));

  const safe = createFileSystemStore({ root });
  const manifest = await safe.list();
  assert.deepEqual(manifest.map((item) => item.key), ["nested/app.js"]);
  assert.equal(manifest[0]?.contentType, "text/javascript; charset=utf-8");
  assert.equal((await safe.read("nested/app.js", manifest[0]!)).toString(), "export {};");

  const following = createFileSystemStore({ root, followSymlinks: true });
  await assert.rejects(following.metadata("escape.txt"), /outside/);
});
