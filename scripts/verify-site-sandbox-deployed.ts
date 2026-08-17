import "./load-env";
import assert from "node:assert/strict";
import { expectedSiteSandboxManifest, siteSandboxManifestSchema } from "../packages/site-contracts";
import { sitePlatformRepository } from "../packages/platform-data";
import {
  configuredSiteSandboxClientForDeployment,
  configuredSiteSandboxRuntimeForSlot,
  SiteSandboxClient,
  SiteSandboxRequestError
} from "../packages/site-sandbox";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

const configuredSessionId = process.env.LODESTA_SANDBOX_CANARY_SESSION_ID?.trim();
const sessionId = configuredSessionId || `sandbox_verify_${crypto.randomUUID().replaceAll("-", "")}`;
assert(/^[a-z0-9_-]{1,80}$/.test(sessionId), "LODESTA_SANDBOX_CANARY_SESSION_ID is invalid.");
const sandbox = await canarySandboxClient();
const buildInput = buildSyntheticSiteInput("site-runtime-v4");
const expectedManifest = configuredExpectedManifest();
const validFiles = [{
  path: "src/site.tsx",
  content: `import { BusinessAddress, BusinessHours, BusinessName } from "#lodesta-sdk";
export const siteDefinition = {
  routes: [{
    path: "/",
    element: <main><h1><BusinessName /></h1><BusinessAddress locationId="location_primary" /><BusinessHours locationId="location_primary" /></main>
  }]
};`
}, {
  path: "src/styles.css",
  content: "body{margin:0;font:16px Arial,sans-serif}main{padding:2rem}"
}, {
  path: "src/retained-content.ts",
  content: `export const retainedContent = ${JSON.stringify("Representative retained source content. ".repeat(14_000))};`
}];
let verificationError: unknown;

try {
  const bootstrapped = await sandbox.bootstrap(sessionId, buildInput);
  assert(bootstrapped.revision, "Deployed sandbox bootstrap did not return a revision.");
  const diagnostics = await sandbox.diagnostics(sessionId);
  assert.equal(diagnostics.ok, true, "Deployed sandbox diagnostics are unhealthy.");
  assert.deepEqual(
    diagnostics.sandboxManifest,
    expectedManifest,
    "Deployed sandbox manifest does not match the controller contract."
  );
  assert.equal(diagnostics.activeGeneration?.status, "initialized", "Bootstrap did not expose one initialized active generation.");
  const applied = await sandbox.apply(sessionId, bootstrapped.revision, validFiles);
  assert(applied.revision !== bootstrapped.revision, "Deployed sandbox apply did not advance the revision.");
  assert.equal(applied.activeGenerationRevision, applied.revision, "Apply did not atomically activate its generation.");
  assert(applied.operationId, "Apply did not report its deterministic operation identity.");
  const firstPreview = await sandbox.fetchPreview(sessionId);
  assert.equal(firstPreview.status, 200, "The first deployed preview did not become reachable.");
  assert((await firstPreview.text()).includes(buildInput.business.name), "The first deployed preview did not serve canonical business data.");
  const retainedSource = await sandbox.getSource(sessionId);
  const retainedArtifact = await sandbox.getArtifact(sessionId);
  const invalidBuildStartedAt = Date.now();
  await assert.rejects(
    () => sandbox.apply(sessionId, applied.revision, [{
      path: "src/site.tsx",
      content: "import { missingView } from './missing'; export const siteDefinition = { routes: [{ path: '/', element: <main>{missingView}</main> }] };"
    }, validFiles[1]!, validFiles[2]!]),
    (error) => error instanceof SiteSandboxRequestError && error.status === 422 && error.providerCode === "build_failed",
    "Invalid source did not return a repairable build failure."
  );
  const invalidBuildDurationMs = Date.now() - invalidBuildStartedAt;
  assert(invalidBuildDurationMs < 60_000, `Production-sized invalid build took ${invalidBuildDurationMs}ms instead of returning promptly.`);
  const afterFailure = await sandbox.diagnostics(sessionId);
  assert.equal(afterFailure.revision, applied.revision, "Failed source changed the active generation revision.");
  assert.deepEqual((await sandbox.getSource(sessionId)).files, retainedSource.files, "Failed source changed the active generation source.");
  assert.deepEqual(await sandbox.getArtifact(sessionId), retainedArtifact, "Failed source changed the active generation artifact.");
  const replayed = await sandbox.apply(sessionId, bootstrapped.revision, validFiles);
  assert.equal(replayed.revision, applied.revision, "Repeated operation did not return the retained generation.");
  assert.equal(replayed.replayed, true, "Repeated operation rebuilt instead of returning its journaled result.");
  const repairedFiles = validFiles.map((file) => file.path === "src/styles.css"
    ? { ...file, content: `${file.content} h1{line-height:1.1}` }
    : file);
  const repairStartedAt = Date.now();
  const repaired = await sandbox.apply(sessionId, applied.revision, repairedFiles);
  const repairDurationMs = Date.now() - repairStartedAt;
  assert(repairDurationMs < 60_000, `Production-sized repair took ${repairDurationMs}ms instead of returning promptly.`);
  assert.notEqual(repaired.revision, applied.revision, "A valid build after an invalid build did not advance the active generation.");
  assert.equal(repaired.activeGenerationRevision, repaired.revision, "The valid post-failure build was not promoted atomically.");
  const concurrentFiles = repairedFiles.map((file) => file.path === "src/styles.css"
    ? { ...file, content: `${file.content} p{max-width:65ch}` }
    : file);
  const concurrent = await Promise.allSettled([
    sandbox.apply(sessionId, repaired.revision, concurrentFiles),
    sandbox.apply(sessionId, repaired.revision, concurrentFiles)
  ]);
  const concurrentSuccesses = concurrent
    .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<SiteSandboxClient["apply"]>>> => result.status === "fulfilled")
    .map((result) => result.value);
  const concurrentFailures = concurrent.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  assert(concurrentSuccesses.length >= 1, `Concurrent identical mutations produced no successful build: ${concurrentFailures
    .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason))
    .join(" | ")}`);
  assert(concurrentSuccesses.every((result) => result.revision === concurrentSuccesses[0]?.revision), "Concurrent identical mutations produced different generations.");
  assert(concurrentSuccesses.filter((result) => !result.replayed).length === 1, "Concurrent identical mutations executed more than one build.");
  assert(concurrentFailures.every((result) => result.reason instanceof SiteSandboxRequestError
    && result.reason.status === 409
    && result.reason.providerCode === "operation_in_progress"), `Concurrent duplicate returned an unexpected failure: ${concurrentFailures
      .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason))
      .join(" | ")}`);
  const concurrentReplay = await sandbox.apply(sessionId, repaired.revision, concurrentFiles);
  assert.equal(concurrentReplay.revision, concurrentSuccesses[0]?.revision, "Concurrent operation replay did not retain the promoted generation.");
  assert.equal(concurrentReplay.replayed, true, "Concurrent operation replay executed a second build.");
  const backup = await sandbox.backup(sessionId);
  const rebootstrapped = await sandbox.bootstrap(sessionId, buildInput);
  const restored = await sandbox.restore(
    sessionId,
    backup.backup.id,
    rebootstrapped.revision,
    backup.backup.contentHash
  );
  const restoredDiagnostics = await sandbox.diagnostics(sessionId);
  assert.deepEqual(
    restoredDiagnostics.sandboxManifest,
    expectedManifest,
    "Restored workspace did not retain the current container manifest."
  );
  const restoredSource = await sandbox.getSource(sessionId);
  assert(restoredSource.files.some((file) => file.path === "src/site.tsx"), "Restored workspace lost authored source.");
  const rebuilt = await sandbox.apply(sessionId, restored.revision, restoredSource.files);
  const artifact = await sandbox.getArtifact(sessionId);
  assert.deepEqual(artifact.compilerManifest, expectedManifest, "Deployed compiler artifact reported a different manifest.");
  assert.equal(artifact.routes[0]?.path, "/", "Deployed compiler canary did not emit the homepage.");
  assert(artifact.routes[0]?.bodyHtml.includes(buildInput.business.name), "Deployed compiler canary did not render canonical business data.");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    provider: "cloudflare-sandbox",
    manifest: diagnostics.sandboxManifest,
    buildDurationMs: rebuilt.buildDurationMs,
    restoreContract: "immutable_generation",
    transactionFailureIsolation: "pass",
    operationReplay: "pass",
    concurrentOperationDeduplication: "pass",
    invalidBuildDurationMs,
    repairDurationMs,
    artifactRoutes: artifact.routes.length
  })}\n`);
} catch (error) {
  verificationError = error;
}

let cleanupError: unknown;
try {
  await sandbox.destroy(sessionId);
} catch (error) {
  cleanupError = error;
}

if (verificationError && cleanupError) {
  throw new AggregateError([verificationError, cleanupError], "Deployed sandbox verification and cleanup failed.");
}
if (verificationError) throw verificationError;
if (cleanupError) throw cleanupError;

function configuredExpectedManifest() {
  const source = process.env.LODESTA_EXPECTED_SANDBOX_MANIFEST_JSON;
  if (!source) return expectedSiteSandboxManifest;
  return siteSandboxManifestSchema.parse(JSON.parse(source));
}

async function canarySandboxClient() {
  const directUrl = process.env.LODESTA_SANDBOX_CANARY_URL?.trim();
  const directToken = process.env.LODESTA_SANDBOX_CANARY_TOKEN?.trim();
  if (directUrl || directToken) {
    assert(directUrl && directToken, "LODESTA_SANDBOX_CANARY_URL and LODESTA_SANDBOX_CANARY_TOKEN must be provided together.");
    return new SiteSandboxClient(directUrl, directToken);
  }
  const slot = process.env.LODESTA_SANDBOX_CANARY_SLOT?.trim();
  if (slot === "blue" || slot === "green") {
    const runtime = configuredSiteSandboxRuntimeForSlot(slot);
    return new SiteSandboxClient(runtime.url, runtime.token);
  }
  const control = await sitePlatformRepository.getSandboxControl();
  assert(control, "Sandbox control is not registered.");
  const deployment = await sitePlatformRepository.getSandboxDeployment(control.activeDeploymentId);
  assert(deployment, "Active sandbox deployment is missing.");
  return configuredSiteSandboxClientForDeployment(deployment);
}
