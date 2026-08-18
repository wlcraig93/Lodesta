import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeSiteToolchainIdentity,
  fingerprintSiteToolchainEntries,
  synchronizeSiteSandboxManifest
} from "./site-sandbox-manifest";

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
const packageLock = JSON.parse(await readFile("package-lock.json", "utf8")) as {
  packages?: Record<string, { version?: string }>;
};
const sandboxSdkVersion = packageLock.packages?.["node_modules/@cloudflare/sandbox"]?.version;
const sandboxDockerfile = await readFile("workers/site-sandbox/Dockerfile", "utf8");
const sandboxWorkerSource = await readFile("workers/site-sandbox/src/index.ts", "utf8");
const sandboxImageVersion = sandboxDockerfile.match(/^FROM docker\.io\/cloudflare\/sandbox:([^\s@]+)(?:@\S+)?$/m)?.[1];
assert.ok(sandboxSdkVersion, "The installed @cloudflare/sandbox SDK version is unavailable.");
assert.equal(
  sandboxImageVersion,
  sandboxSdkVersion,
  "The Cloudflare Sandbox SDK and container image versions must match exactly."
);
assert.match(
  sandboxWorkerSource,
  /async function sandboxFor[\s\S]*await sandbox\.setSleepAfter\("15m"\);[\s\S]*await sandbox\.setKeepAlive\(false\);/,
  "Sandbox lifecycle configuration must complete before filesystem work begins."
);

const fixtureRoot = await mkdtemp(join(tmpdir(), "lodesta-sandbox-manifest-"));
try {
  await cp("workers/site-sandbox", join(fixtureRoot, "workers/site-sandbox"), {
    recursive: true,
    filter: (source) => !source.includes("/node_modules") && !source.includes("/dist")
  });
  await cp("packages/site-contracts", join(fixtureRoot, "packages/site-contracts"), { recursive: true });
  const fixtureIdentity = await computeSiteToolchainIdentity(fixtureRoot);
  for (const relativePath of [
    "workers/site-sandbox/Dockerfile",
    "workers/site-sandbox/.dockerignore",
    "workers/site-sandbox/src/index.ts",
    "workers/site-sandbox/wrangler.blue.jsonc",
    "workers/site-sandbox/wrangler.green.jsonc",
    "workers/site-sandbox/scaffold/package-lock.json",
    "workers/site-sandbox/scaffold/vite.config.ts"
  ]) {
    const target = join(fixtureRoot, relativePath);
    const original = await readFile(target);
    await writeFile(target, Buffer.concat([original, Buffer.from("\nproduction identity input change\n")]));
    assert.notEqual(
      await computeSiteToolchainIdentity(fixtureRoot),
      fixtureIdentity,
      `${relativePath} did not change the production identity.`
    );
    await writeFile(target, original);
  }
  for (const slot of ["blue", "green"]) {
    const devConfig = join(fixtureRoot, `workers/site-sandbox/wrangler.dev.${slot}.jsonc`);
    const original = await readFile(devConfig, "utf8");
    await writeFile(devConfig, `${original}\n// development-only change\n`);
    assert.equal(
      await computeSiteToolchainIdentity(fixtureRoot),
      fixtureIdentity,
      `Development ${slot} Wrangler configuration changed the production identity.`
    );
    await writeFile(devConfig, original);
  }
  const controllerClient = join(fixtureRoot, "packages/site-sandbox/client.ts");
  await mkdir(join(fixtureRoot, "packages/site-sandbox"), { recursive: true });
  await writeFile(controllerClient, "// controller-only change\n");
  assert.equal(
    await computeSiteToolchainIdentity(fixtureRoot),
    fixtureIdentity,
    "Controller client changes changed the production identity."
  );
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
  developmentConfigIndependent: true,
  workerBridgeCovered: true,
  sandboxSdkImageVersionAligned: true,
  sandboxLifecycleConfigurationAwaited: true,
  rejectsModifiedGeneratedFile: true
})}\n`);
