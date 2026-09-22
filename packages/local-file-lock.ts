import { mkdir, open, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";

// Local JSON stores are read-modify-written by the web server, the worker and
// operator scripts at the same time. An in-process queue alone lets another
// process's write replace this one, so every local store write also holds an
// exclusive lock file for the store path.
const staleLockMs = 30_000;

export async function withLocalFileLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = await stat(lockPath).catch(() => undefined);
      if (current && Date.now() - current.mtimeMs > staleLockMs) {
        await unlink(lockPath).catch(() => undefined);
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 20));
    }
  }
  try {
    return await operation();
  } finally {
    await unlink(lockPath).catch(() => undefined);
  }
}
