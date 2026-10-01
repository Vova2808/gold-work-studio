import { join, resolve } from "node:path";
import { EffectLibrary } from "../src/effect-library.js";

// Runs the same importer as the desktop IPC. Only copies the explicitly supplied roots.
const args = process.argv.slice(2);
if (args.length < 2) throw new Error("Usage: tsx scripts/import-effect-packs.ts <Library path> <source folder> [...folders]");
let last = -1;
const library = new EffectLibrary(resolve(args[0]!), progress => {
  if (progress.processed !== last || ["complete", "cancelled", "error"].includes(progress.status)) {
    last = progress.processed;
    console.log(JSON.stringify({ status: progress.status, processed: progress.processed, total: progress.total, added: progress.added, duplicates: progress.duplicates, errors: progress.errors.length }));
  }
});
process.on("SIGINT", () => library.cancel());
await library.startImport(args.slice(1).map(path => resolve(path)));
const result = await library.waitForImport();
console.log(JSON.stringify({ root: result.rootPath, count: result.assets.length, report: join(result.rootPath, "Catalog", "import.json"), errors: result.importProgress?.errors }));
if (result.importProgress?.errors.length || result.importProgress?.status !== "complete") process.exitCode = 1;
