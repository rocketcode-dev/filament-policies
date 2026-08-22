import { lstat, mkdir, readFile, readlink, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path"; import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."); const source = resolve(root, process.env.FILAMENTJS_SOURCE ?? "../../../filament"); const destination = resolve(root, "node_modules/filamentjs");
const sm = JSON.parse(await readFile(resolve(source, "package.json"), "utf8")); const pm = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
if (sm.name !== "filamentjs" || sm.version !== pm.peerDependencies?.filamentjs) throw new Error("Local Filament source does not match the exact peer version"); await mkdir(dirname(destination), { recursive: true });
try { const item = await lstat(destination); if (!item.isSymbolicLink() || resolve(dirname(destination), await readlink(destination)) !== source) throw new Error("filamentjs link is not the required local source"); } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") await symlink(source, destination, "dir"); else throw error; }
