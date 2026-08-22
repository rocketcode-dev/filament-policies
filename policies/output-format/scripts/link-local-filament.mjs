import { lstat, mkdir, readFile, readlink, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(packageRoot, process.env.FILAMENTJS_SOURCE ?? "../../../filament");
const destination = resolve(packageRoot, "node_modules/filamentjs");
const sourceManifest = JSON.parse(await readFile(resolve(source, "package.json"), "utf8"));
const packageManifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
if (sourceManifest.name !== "filamentjs" || sourceManifest.version !== packageManifest.peerDependencies?.filamentjs) throw new Error("Local Filament source does not match the exact peer version");
await mkdir(dirname(destination), { recursive: true });
try { const item = await lstat(destination); if (!item.isSymbolicLink() || resolve(dirname(destination), await readlink(destination)) !== source) throw new Error("filamentjs link is not the required local source"); }
catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") await symlink(source, destination, "dir"); else throw error; }
