import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { withLocalFileLock } from "../packages/local-file-lock";

// Child mode: append `count` distinct entries to the shared store, one locked
// read-modify-write per entry, exactly like the local repositories do.
if (process.argv[2] === "child") {
  const [, , , path, label, count] = process.argv;
  for (let index = 0; index < Number(count); index += 1) {
    await withLocalFileLock(path!, async () => {
      const state = JSON.parse(await readFile(path!, "utf8").catch(() => "[]")) as string[];
      state.push(`${label}-${index}`);
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(state));
      await rename(temporary, path!);
    });
  }
  process.exit(0);
}

const directory = await mkdtemp(join(tmpdir(), "lodesta-local-lock-"));
const path = join(directory, "store.json");
const processes = 4;
const writesPerProcess = 25;
await Promise.all(Array.from({ length: processes }, (_, index) =>
  promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/verify-local-file-lock.ts", "child", path, `p${index}`, String(writesPerProcess)])));
const entries = JSON.parse(await readFile(path, "utf8")) as string[];
assert.equal(entries.length, processes * writesPerProcess, "Concurrent local store writers lost updates.");
assert.equal(new Set(entries).size, entries.length);
console.log(JSON.stringify({ ok: true, processes, writes: entries.length }));
