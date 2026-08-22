import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type {
  FileSystemStoreOptions,
  ResourceMetadata,
  ResourceStore,
} from "./types.js";

const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
});

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
}

function etag(size: number, mtimeMs: number): string {
  return `W/\"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}\"`;
}

export function createFileSystemStore(
  options: FileSystemStoreOptions,
): ResourceStore {
  if (options.root.length === 0) throw new TypeError("root must not be empty");
  const configuredRoot = resolve(options.root);
  const follow = options.followSymlinks ?? false;
  const dots = options.includeDotfiles ?? false;
  const maximum = options.maxBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(maximum) || maximum < 0)
    throw new RangeError("maxBytes must be a non-negative safe integer");
  let rootPromise: Promise<string> | undefined;
  const root = () => (rootPromise ??= realpath(configuredRoot));

  async function targetFor(key: string): Promise<string> {
    const base = await root();
    const target = resolve(base, ...key.split("/"));
    if (!inside(base, target))
      throw new Error("Resource is outside the configured root");
    const entry = await lstat(target);
    if (entry.isSymbolicLink() && !follow)
      throw new Error("Symbolic links are disabled");
    const actual = await realpath(target);
    if (!inside(base, actual))
      throw new Error("Resource resolves outside the configured root");
    return actual;
  }

  async function metadata(key: string): Promise<ResourceMetadata | undefined> {
    try {
      const target = await targetFor(key);
      const info = await stat(target);
      if (!info.isFile()) return undefined;
      if (info.size > maximum) throw new Error("Resource exceeds maxBytes");
      return {
        key,
        byteLength: info.size,
        lastModified: info.mtime,
        contentType:
          CONTENT_TYPES[extname(key).toLowerCase()] ??
          "application/octet-stream",
        etag: etag(info.size, info.mtimeMs),
        version: `${info.size}:${info.mtimeMs}`,
      };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return undefined;
      throw error;
    }
  }

  return {
    async list() {
      const base = await root();
      const result: ResourceMetadata[] = [];
      async function visit(directory: string, prefix: string): Promise<void> {
        const entries = await readdir(directory, { withFileTypes: true });
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (!dots && entry.name.startsWith(".")) continue;
          if (entry.isSymbolicLink() && !follow) continue;
          const key = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
          const target = resolve(directory, entry.name);
          if (entry.isDirectory()) await visit(target, key);
          else {
            const item = await metadata(key);
            if (item !== undefined) result.push(item);
          }
        }
      }
      await visit(base, "");
      return result;
    },
    metadata,
    async read(key, expected) {
      const target = await targetFor(key);
      const data = await readFile(target);
      if (data.byteLength > maximum) {
        throw new Error("Resource exceeds maxBytes");
      }
      return data;
    },
  };
}
