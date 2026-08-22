import { lstat, mkdir, readFile, readlink, symlink } from "node:fs/promises"; import { dirname, resolve } from "node:path"; import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."); const source = resolve(root, process.env.FILAMENTJS_SOURCE ?? "../../../filament"); const destination = resolve(root, "node_modules/filamentjs"); const sm = JSON.parse(await readFile(resolve(source, "package.json"), "utf8")); const pm = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
if (sm.name !== "filamentjs" || sm.version !== pm.peerDependencies?.filamentjs) throw new Error("Local Filament source does not match exact peer"); await mkdir(dirname(destination), { recursive: true });
try { const item = await lstat(destination); if (!item.isSymbolicLink() || resolve(dirname(destination), await readlink(destination)) !== source) throw new Error("filamentjs link is not required local source"); } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") await symlink(source, destination, "dir"); else throw error; }

const outputSource = resolve(root, "../output-format");
const outputDestination = resolve(root, "node_modules/@filamentjs/output-format");
await mkdir(dirname(outputDestination), { recursive: true });
try {
  const item = await lstat(outputDestination);
  if (!item.isSymbolicLink() || resolve(dirname(outputDestination), await readlink(outputDestination)) !== outputSource) throw new Error("output-format link is not required local source");
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") await symlink(outputSource, outputDestination, "dir");
  else throw error;
}
