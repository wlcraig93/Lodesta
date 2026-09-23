import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSteps } from "../packages/site-sandbox/railway-client";

// Template recipes carry no uploads; the lockfile must survive the shell steps byte for byte.
const directory = await mkdtemp(join(tmpdir(), "lodesta-template-steps-"));
for (const name of ["package.json", "package-lock.json"]) {
  const source = await readFile(join("workers/site-sandbox/scaffold", name));
  const target = join(directory, name);
  for (const step of writeFileSteps(target, source)) execFileSync("bash", ["-c", step]);
  assert.deepEqual(await readFile(target), source, `${name} changed while written through template steps.`);
}
const binary = Buffer.from(Array.from({ length: 40_000 }, (_, index) => (index * 31) % 256));
const binaryTarget = join(directory, "binary");
for (const step of writeFileSteps(binaryTarget, binary)) execFileSync("bash", ["-c", step]);
assert.deepEqual(await readFile(binaryTarget), binary, "Binary content changed while written through template steps.");
console.log("Railway template file steps reproduce files byte for byte.");
