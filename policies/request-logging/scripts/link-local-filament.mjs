import { lstat, mkdir, readFile, readlink, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configuredSource = process.env.FILAMENTJS_SOURCE ?? "../../../filament";
const source = resolve(packageRoot, configuredSource);
const destination = resolve(packageRoot, "node_modules/filamentjs");

const sourceManifest = JSON.parse(
  await readFile(resolve(source, "package.json"), "utf8"),
);
const packageManifest = JSON.parse(
  await readFile(resolve(packageRoot, "package.json"), "utf8"),
);
const expectedVersion = packageManifest.peerDependencies?.filamentjs;

if (sourceManifest.name !== "filamentjs") {
  throw new Error(`Local Filament source is not the filamentjs package: ${source}`);
}
if (sourceManifest.version !== expectedVersion) {
  throw new Error(
    `Local Filament ${sourceManifest.version} does not match peer ${expectedVersion}`,
  );
}

await mkdir(dirname(destination), { recursive: true });

try {
  const existing = await lstat(destination);
  if (!existing.isSymbolicLink()) {
    throw new Error(
      "node_modules/filamentjs exists but is not the required local-source link",
    );
  }
  const currentTarget = resolve(dirname(destination), await readlink(destination));
  if (currentTarget !== source) {
    throw new Error(
      `node_modules/filamentjs links to ${currentTarget}, expected ${source}`,
    );
  }
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    await symlink(source, destination, "dir");
  } else {
    throw error;
  }
}
