import { copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const RETRIABLE_CODES = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"]);
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Атомарная запись файла с ретраями: OneDrive/антивирус на Windows периодически
 * блокируют rename (EPERM/EBUSY). Пробуем несколько раз, затем fallback copy+rm.
 */
let temporaryCounter = 0;

export async function atomicWrite(filePath: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  // Счётчик обязателен: параллельные записи одного файла в одну миллисекунду делили tmp-имя (ENOENT на rename).
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${temporaryCounter++}.tmp`;
  await writeFile(temporaryPath, data);
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      await rename(temporaryPath, filePath);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!RETRIABLE_CODES.has(code)) break;
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }
  // Fallback: прямое копирование (не атомарно, но надёжно при залоченном rename).
  try {
    await copyFile(temporaryPath, filePath);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    return;
  } catch {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw lastError;
  }
}
