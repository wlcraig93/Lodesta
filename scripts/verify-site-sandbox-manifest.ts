import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fingerprintSiteToolchainEntries, synchronizeSiteSandboxManifest } from "./site-sandbox-manifest";

const first = fingerprintSiteToolchainEntries([
  { path: "b.txt", bytes: Buffer.from("second") },
  { path: "a.txt", bytes: Buffer.from("first") }
]);
const reordered = fingerprintSiteToolchainEntries([
  { path: "a.txt", bytes: Buffer.from("first") },
  { path: "b.txt", bytes: Buffer.from("second") }
]);
const changed = fingerprintSiteToolchainEntries([
  { path: "a.txt", bytes: Buffer.from("changed") },
  { path: "b.txt", bytes: Buffer.from("second") }
]);

assert.equal(first, reordered, "Toolchain fingerprint depends on filesystem enumeration order.");
assert.notEqual(first, changed, "Toolchain fingerprint did not change when a source input changed.");
const result = await synchronizeSiteSandboxManifest({ mode: "check" });

const fixtureRoot = await mkdtemp(join(tmpdir(), "lodesta-sandbox-manifest-"));
try {
  await cp("workers/site-sandbox", join(fixtureRoot, "workers/site-sandbox"), {
    recursive: true,
    filter: (source) => !source.includes("/node_modules") && !source.includes("/dist")
  });
  await cp("packages/site-contracts", join(fixtureRoot, "packages/site-contracts"), { recursive: true });
  const generatedTarget = join(fixtureRoot, "workers/site-sandbox/scaffold/lodesta-manifest.json");
  const generated = await readFile(generatedTarget, "utf8");
  await writeFile(generatedTarget, generated.replace("site-sandbox-manifest", "modified-site-sandbox-manifest"));
  await assert.rejects(
    synchronizeSiteSandboxManifest({ root: fixtureRoot, mode: "check" }),
    /disagree|stale|invalid/i,
    "Verification accepted a modified generated manifest."
  );
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  identity: result.identity,
  deterministic: true,
  changedInput: true,
  rejectsModifiedGeneratedFile: true
})}\n`);
