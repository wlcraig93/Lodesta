import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  expectedSiteSandboxManifest,
  siteSandboxDeploymentSchema,
  type SiteSandboxSlot
} from "../packages/site-contracts";
import {
  computeDevelopmentSandboxConfigHash,
  configuredSiteSandboxRuntimeForDeployment,
  configuredSiteSandboxRuntimeForSlot,
  developmentSandboxDeploymentMatchesCheckout,
  developmentSandboxReceiptPath,
  developmentSandboxTokenPath,
  developmentSandboxWorkerName,
  isUninitializedSandboxRevision,
  readDevelopmentSandboxToken,
  SiteSandboxClient,
  SiteSandboxRequestError,
  type DevelopmentSandboxReceipt
} from "../packages/site-sandbox";
import { ensureDevelopmentSandboxToken } from "./development-sandbox-token";
import { computeSiteToolchainIdentity } from "./site-sandbox-manifest";

const deploymentSource = await readFile("scripts/deploy-site-sandbox-dev.ts", "utf8");
const developmentPreflightSource = await readFile("scripts/ensure-site-sandbox-dev.ts", "utf8");
assert(deploymentSource.includes("const attempts = 12")
  && deploymentSource.includes("manifest does not match")
  && deploymentSource.includes("runtime connection was closing")
  && deploymentSource.includes("controller contract"), "Development deployment must retry the exact canary while a new container revision propagates.");
assert(
  deploymentSource.includes("--slot=")
    && deploymentSource.includes("site-sandbox-dev-${slot}-deploy.log")
    && developmentPreflightSource.includes("assertSlotAvailable")
    && developmentPreflightSource.includes("developmentSandboxDeploymentMatchesCheckout")
    && developmentPreflightSource.includes("saveSandboxDeployment")
    && developmentPreflightSource.match(/saveSandboxControl/g)?.length === 3,
  "Development must deploy, register, and promote one drained inactive blue-green slot."
);
assert(
  developmentPreflightSource.includes("acquireDevelopmentDeploymentLock")
    && developmentPreflightSource.indexOf("await acquireDevelopmentDeploymentLock")
      < developmentPreflightSource.indexOf("getSandboxControl")
    && developmentPreflightSource.includes("process.once(\"exit\", deploymentLock.release)"),
  "Development must serialize the full control-read, deploy, and promotion sequence across local processes."
);
assert(
  isUninitializedSandboxRevision(new SiteSandboxRequestError(
    "apply", "sandbox_test", 409, "revision_conflict", "currentRevision=uninitialized"
  )),
  "An evicted sandbox revision was not recognized as deterministically reinitializable."
);

const fixture = await mkdtemp(join(tmpdir(), "lodesta-development-sandbox-"));
try {
  await cp("workers/site-sandbox", join(fixture, "workers/site-sandbox"), {
    recursive: true,
    filter: (source) => !source.includes("/node_modules") && !source.includes("/dist")
  });
  const identity = await computeSiteToolchainIdentity(fixture);
  assert.equal(identity, expectedSiteSandboxManifest.toolchainIdentity, "fixture toolchain identity drifted from the checkout");

  const environment = {
    NODE_ENV: "development",
    LODESTA_DEV_SANDBOX: "1",
    LODESTA_DEV_SANDBOX_BLUE_TOKEN: "development-blue-token-which-is-distinct",
    LODESTA_DEV_SANDBOX_GREEN_TOKEN: "development-green-token-which-is-distinct",
    LODESTA_SANDBOX_BLUE_URL: "https://production-blue.example.workers.dev",
    LODESTA_SANDBOX_BLUE_TOKEN: "production-blue-token-which-is-distinct",
    LODESTA_SANDBOX_GREEN_URL: "https://production-green.example.workers.dev",
    LODESTA_SANDBOX_GREEN_TOKEN: "production-green-token-which-is-distinct"
  } satisfies NodeJS.ProcessEnv;

  const deployments = Object.fromEntries(await Promise.all((["blue", "green"] as const).map(async (slot) => {
    const receipt = developmentReceipt(slot, fixture);
    const path = join(fixture, developmentSandboxReceiptPath(slot));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`);
    const deployment = siteSandboxDeploymentSchema.parse({
      schemaVersion: 1,
      id: `sandbox_deployment_${slot}_${"d".repeat(24)}`,
      slot,
      workerVersionId: receipt.workerVersionId,
      releaseSha: receipt.releaseSha,
      imageDigest: receipt.imageDigest,
      credentialSlot: slot,
      manifest: receipt.sandboxManifest,
      createdAt: receipt.deployedAt
    });
    return [slot, deployment] as const;
  })));

  for (const slot of ["blue", "green"] as const) {
    const runtime = configuredSiteSandboxRuntimeForDeployment(deployments[slot], environment, fixture);
    assert.equal(runtime.mode, "development");
    assert(runtime.url.includes(developmentSandboxWorkerName(slot)));
    assert.equal(runtime.imageDigest, deployments[slot].imageDigest);
    configuredSiteSandboxRuntimeForDeployment(deployments[slot], environment, fixture);
    assert.equal(await developmentSandboxDeploymentMatchesCheckout(deployments[slot], fixture), true);
  }

  assert.throws(
    () => configuredSiteSandboxRuntimeForSlot("blue", { ...environment, LODESTA_DEV_SANDBOX: "0", LODESTA_SANDBOX_GREEN_URL: environment.LODESTA_SANDBOX_BLUE_URL }),
    /URLs must differ/i
  );
  assert.throws(
    () => configuredSiteSandboxRuntimeForDeployment(deployments.blue, {
      ...environment,
      LODESTA_DEV_SANDBOX_GREEN_TOKEN: environment.LODESTA_DEV_SANDBOX_BLUE_TOKEN
    }, fixture),
    /tokens must differ/i
  );

  const tokenFixture = join(fixture, "generated-token");
  const emptyEnvironment = { NODE_ENV: "development" } satisfies NodeJS.ProcessEnv;
  const generatedBlue = await ensureDevelopmentSandboxToken("blue", emptyEnvironment, tokenFixture);
  const generatedGreen = await ensureDevelopmentSandboxToken("green", emptyEnvironment, tokenFixture);
  assert.notEqual(generatedBlue.token, generatedGreen.token, "Development slots shared a generated credential.");
  assert.equal(readDevelopmentSandboxToken("blue", emptyEnvironment, tokenFixture), generatedBlue.token);
  assert.equal((await ensureDevelopmentSandboxToken("blue", emptyEnvironment, tokenFixture)).created, false);
  assert(await readFile(join(tokenFixture, developmentSandboxTokenPath("green")), "utf8"));

  const blueConfig = join(fixture, "workers/site-sandbox/wrangler.dev.blue.jsonc");
  const originalBlueConfig = await readFile(blueConfig, "utf8");
  await writeFile(blueConfig, `${originalBlueConfig}\n`);
  assert.equal(
    await developmentSandboxDeploymentMatchesCheckout(deployments.blue, fixture),
    false,
    "Development preflight treated a changed slot configuration as current."
  );
  configuredSiteSandboxRuntimeForDeployment(deployments.blue, environment, fixture);
  await writeFile(blueConfig, originalBlueConfig);
  assert.equal(await developmentSandboxDeploymentMatchesCheckout(deployments.blue, fixture), true);

  const workerSource = join(fixture, "workers/site-sandbox/src/index.ts");
  await writeFile(workerSource, `${await readFile(workerSource, "utf8")}\n// changed\n`);
  assert.notEqual(
    await computeSiteToolchainIdentity(fixture),
    deployments.green.manifest.toolchainIdentity,
    "The source-drift fixture did not change the sandbox toolchain identity."
  );
  assert.equal(
    await developmentSandboxDeploymentMatchesCheckout(deployments.green, fixture),
    false,
    "Development preflight treated changed sandbox source as current."
  );

  const priorManifest = {
    ...expectedSiteSandboxManifest,
    toolchainIdentity: `lodesta-static-site-workspace@sha256:${"0".repeat(64)}`
  };
  const priorReceipt = { ...developmentReceipt("green", fixture), sandboxManifest: priorManifest };
  await writeFile(
    join(fixture, developmentSandboxReceiptPath("green")),
    `${JSON.stringify(priorReceipt, null, 2)}\n`
  );
  const pinnedGreen = siteSandboxDeploymentSchema.parse({
    ...deployments.green,
    id: `sandbox_deployment_green_prior_${"e".repeat(16)}`,
    manifest: priorManifest
  });
  assert.equal(await developmentSandboxDeploymentMatchesCheckout(pinnedGreen, fixture), false);
  configuredSiteSandboxRuntimeForDeployment(pinnedGreen, environment, fixture);
  await verifyPinnedRequestSurvivesCheckoutDrift(pinnedGreen, environment, fixture);

  const incompatible = siteSandboxDeploymentSchema.parse({
    ...pinnedGreen,
    id: `sandbox_deployment_green_incompatible_${"f".repeat(16)}`,
    manifest: {
      ...priorManifest,
      apiIdentity: `${priorManifest.apiIdentity}-breaking`
    }
  });
  assert.throws(
    () => configuredSiteSandboxRuntimeForDeployment(
      incompatible,
      { ...environment, LODESTA_DEV_SANDBOX: "0" },
      fixture
    ),
    /incompatible with this controller/i,
    "An incompatible pinned sandbox contract was accepted."
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
}

function developmentReceipt(slot: SiteSandboxSlot, root: string): DevelopmentSandboxReceipt {
  return {
    schemaVersion: 1,
    slot,
    workerName: developmentSandboxWorkerName(slot),
    workerVersionId: slot === "blue"
      ? "11111111-1111-4111-8111-111111111111"
      : "22222222-2222-4222-8222-222222222222",
    releaseSha: slot === "blue" ? "a".repeat(40) : "b".repeat(40),
    url: `https://${developmentSandboxWorkerName(slot)}.example.workers.dev`,
    imageDigest: `sha256:${slot === "blue" ? "a".repeat(64) : "b".repeat(64)}`,
    sandboxManifest: expectedSiteSandboxManifest,
    devConfigHash: computeDevelopmentSandboxConfigHash(slot, root),
    deployedAt: "2026-08-03T00:00:00.000Z"
  };
}

async function verifyPinnedRequestSurvivesCheckoutDrift(
  deployment: ReturnType<typeof siteSandboxDeploymentSchema.parse>,
  environment: NodeJS.ProcessEnv,
  root: string
) {
  let requests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify({
      ok: true,
      revision: "uninitialized",
      versions: [],
      sandboxManifest: deployment.manifest,
      placementId: "pinned-green",
      processes: []
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const client = new SiteSandboxClient(
      "https://pinned-green.example.workers.dev",
      "pinned-development-sandbox-token",
      async () => configuredSiteSandboxRuntimeForDeployment(deployment, environment, root)
    );
    const diagnostics = await client.diagnostics("sandbox_pinned_green");
    assert.equal(diagnostics.sandboxManifest.toolchainIdentity, deployment.manifest.toolchainIdentity);
    assert.equal(requests, 1, "Checkout drift blocked the request before it reached the pinned sandbox.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  slots: ["blue", "green"],
  deploymentPin: "exact",
  promotion: "inactive_then_active",
  checkoutDrift: "refreshes_new_deployment_without_interrupting_pin",
  incompatibleContract: "rejected",
  credentialIsolation: "per_slot"
})}\n`);
