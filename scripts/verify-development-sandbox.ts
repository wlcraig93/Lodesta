import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { expectedSiteSandboxManifest } from "../packages/site-contracts";
import {
  assertConfiguredSiteSandboxRuntimeReady,
  computeDevelopmentSandboxConfigHash,
  configuredSiteSandboxRuntime,
  developmentSandboxReceiptPath,
  developmentSandboxTokenPath,
  developmentSandboxWorkerName,
  readDevelopmentSandboxToken,
  type DevelopmentSandboxReceipt
} from "../packages/site-sandbox";
import { ensureDevelopmentSandboxToken } from "./development-sandbox-token";
import { computeSiteToolchainIdentity } from "./site-sandbox-manifest";

const deploymentSource = await readFile("scripts/deploy-site-sandbox-dev.ts", "utf8");
assert(deploymentSource.includes("const attempts = 12")
  && deploymentSource.includes("manifest does not match")
  && deploymentSource.includes("controller contract"), "Development deployment must retry the exact canary while a new container revision propagates.");

const fixture = await mkdtemp(join(tmpdir(), "lodesta-development-sandbox-"));
try {
  await cp("workers/site-sandbox", join(fixture, "workers/site-sandbox"), {
    recursive: true,
    filter: (source) => !source.includes("/node_modules") && !source.includes("/dist")
  });
  const identity = await computeSiteToolchainIdentity(fixture);
  assert.equal(identity, expectedSiteSandboxManifest.toolchainIdentity, "fixture toolchain identity drifted from the checkout");
  const receiptPath = join(fixture, developmentSandboxReceiptPath);
  await mkdir(dirname(receiptPath), { recursive: true });
  const receipt: DevelopmentSandboxReceipt = {
    schemaVersion: 1,
    workerName: developmentSandboxWorkerName,
    url: "https://lodesta-site-sandbox-v1-dev.example.workers.dev",
    imageDigest: `sha256:${"d".repeat(64)}`,
    sandboxManifest: expectedSiteSandboxManifest,
    devConfigHash: computeDevelopmentSandboxConfigHash(fixture),
    deployedAt: new Date().toISOString()
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  const environment = {
    NODE_ENV: "development",
    LODESTA_DEV_SANDBOX: "1",
    LODESTA_DEV_SANDBOX_TOKEN: "development-token-which-is-distinct",
    LODESTA_SANDBOX_URL: "https://lodesta-site-sandbox-v1.example.workers.dev",
    LODESTA_SANDBOX_TOKEN: "production-token-which-is-distinct"
  } satisfies NodeJS.ProcessEnv;
  const runtime = configuredSiteSandboxRuntime(environment, fixture);
  assert.equal(runtime.mode, "development");
  assert.equal(runtime.imageDigest, receipt.imageDigest, "development provenance did not use the deployed receipt digest");
  await assertConfiguredSiteSandboxRuntimeReady(environment, fixture);
  const tokenPath = join(fixture, developmentSandboxTokenPath);
  await writeFile(tokenPath, "development-file-token-which-is-distinct\n", { mode: 0o600 });
  const fileEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    LODESTA_DEV_SANDBOX_TOKEN: undefined
  };
  assert.equal(
    readDevelopmentSandboxToken(fileEnvironment, fixture),
    "development-file-token-which-is-distinct",
    "The generated local credential was not used when no environment override was present."
  );
  assert.equal(configuredSiteSandboxRuntime(fileEnvironment, fixture).mode, "development");

  const tokenFixture = join(fixture, "generated-token");
  const emptyEnvironment = { NODE_ENV: "development" } satisfies NodeJS.ProcessEnv;
  const generated = await ensureDevelopmentSandboxToken(emptyEnvironment, tokenFixture);
  assert.equal(generated.created, true, "First development startup did not create a local credential.");
  assert.equal(readDevelopmentSandboxToken(emptyEnvironment, tokenFixture), generated.token);
  assert.equal((await ensureDevelopmentSandboxToken(emptyEnvironment, tokenFixture)).created, false, "A stable development credential was regenerated.");

  const devConfig = join(fixture, "workers/site-sandbox/wrangler.dev.jsonc");
  const originalDevConfig = await readFile(devConfig, "utf8");
  await writeFile(devConfig, `${originalDevConfig}\n`);
  assert.throws(
    () => configuredSiteSandboxRuntime(environment, fixture),
    /configuration changed/i,
    "development config changes did not invalidate the receipt"
  );
  await writeFile(devConfig, originalDevConfig);

  const workerSource = join(fixture, "workers/site-sandbox/src/index.ts");
  await writeFile(workerSource, `${await readFile(workerSource, "utf8")}\n// changed\n`);
  await assert.rejects(
    assertConfiguredSiteSandboxRuntimeReady(environment, fixture),
    /source changed/i,
    "sandbox source changes did not invalidate the deployed receipt"
  );

  assert.throws(
    () => configuredSiteSandboxRuntime({ ...environment, LODESTA_DEV_SANDBOX_TOKEN: environment.LODESTA_SANDBOX_TOKEN }, fixture),
    /tokens must differ/i,
    "matching development and production tokens were accepted"
  );
  assert.throws(
    () => configuredSiteSandboxRuntime({ ...environment, LODESTA_SANDBOX_URL: receipt.url }, fixture),
    /URLs must differ/i,
    "matching development and production URLs were accepted"
  );
  await writeFile(receiptPath, `${JSON.stringify({ ...receipt, url: "https://unrelated.example.com" }, null, 2)}\n`);
  assert.throws(
    () => configuredSiteSandboxRuntime(environment, fixture),
    /dedicated workers.dev root URL/i,
    "a receipt for an unrelated development URL was accepted"
  );
  await writeFile(receiptPath, "{}\n");
  assert.throws(
    () => configuredSiteSandboxRuntime(environment, fixture),
    /malformed/i,
    "malformed development receipt was accepted"
  );
  await rm(receiptPath);
  assert.throws(
    () => configuredSiteSandboxRuntime(environment, fixture),
    /not deployed/i,
    "missing development receipt was accepted"
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  receipt: "validated",
  sourceStaleness: "rejected",
  configStaleness: "rejected",
  productionFallback: "rejected",
  imageDigestProvenance: "exact",
  rolloutPropagation: "retried"
})}\n`);
