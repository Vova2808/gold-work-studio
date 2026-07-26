// Loads captured JSON fixtures from data/.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DATA = resolve(process.cwd(), "data");

export function fixture(name: string): any {
  const path = resolve(DATA, name);
  // strip UTF-8 BOM if present (Notepad/Windows likes to add it, JSON.parse chokes on it)
  const raw = readFileSync(path, "utf-8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}
