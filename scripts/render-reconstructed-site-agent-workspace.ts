import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { sha256, stableJson } from "../packages/business-data";
import {
  configuredArtifactBlobStore,
  workspaceSourceSidecarKey,
  workspaceSourceSidecarSchema
} from "../packages/site-artifacts";
import { sitePublicBuildInputSchema, type AssetRevisionRef } from "../packages/site-contracts";
import { sitePlatformRepository } from "../packages/platform-data";
import { configuredSiteSandboxClientForDeployment } from "../packages/site-sandbox";
import { prepareSiteArtifact, runArtifactBrowserGate } from "../packages/site-verification";

const runId = process.env.LODESTA_RECONSTRUCT_RUN_ID?.trim();
const reconstructionDirectoryInput = process.env.LODESTA_RECONSTRUCT_OUTPUT_DIR?.trim();
const sandboxDeploymentOverrideId = process.env.LODESTA_RECONSTRUCT_SANDBOX_DEPLOYMENT_ID?.trim();
const repeatApplyAfterInspection = process.env.LODESTA_RECONSTRUCT_REPEAT_APPLY === "1";
const inspectionCountInput = process.env.LODESTA_RECONSTRUCT_INSPECTION_COUNT?.trim();
const useLocalReconstructionSource = process.env.LODESTA_RECONSTRUCT_LOCAL_SOURCE === "1";
const requestedRoutes = (process.env.LODESTA_RECONSTRUCT_ROUTES?.trim()
  || "/,/services,/ants-pest-control-services,/georgetown-pest-control,/about-us,/contact")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);

if (!runId) throw new Error("LODESTA_RECONSTRUCT_RUN_ID is required.");
if (!reconstructionDirectoryInput) throw new Error("LODESTA_RECONSTRUCT_OUTPUT_DIR is required.");
const inspectionCount = inspectionCountInput ? Number(inspectionCountInput) : 1;
if (!Number.isInteger(inspectionCount) || inspectionCount < 1 || inspectionCount > 3) {
  throw new Error("LODESTA_RECONSTRUCT_INSPECTION_COUNT must be an integer from 1 to 3.");
}

const repositoryRoot = resolve(process.cwd());
const reconstructionDirectory = resolve(repositoryRoot, reconstructionDirectoryInput);
const allowedRoot = resolve(repositoryRoot, ".design");
if (!reconstructionDirectory.startsWith(`${allowedRoot}${sep}`)) {
  throw new Error("The reconstruction directory must stay under .design/.");
}

const run = await sitePlatformRepository.getAgentRun(runId);
if (!run) throw new Error(`Unknown site-agent run ${runId}.`);
if (!run.sandboxDeploymentId) throw new Error(`Run ${runId} has no pinned sandbox deployment.`);
const candidateVersion = run.candidateVersionId
  ? await sitePlatformRepository.getSiteVersion(run.candidateVersionId)
  : undefined;
if (run.candidateVersionId && !candidateVersion) throw new Error(`Candidate version ${run.candidateVersionId} is unavailable.`);
const retainedBuildInputId = candidateVersion?.publicBuildInputId ?? run.publicBuildInputId;
const [deployment, retainedBuildInput, events] = await Promise.all([
  sitePlatformRepository.getSandboxDeployment(sandboxDeploymentOverrideId || run.sandboxDeploymentId),
  sitePlatformRepository.getPublicBuildInput(retainedBuildInputId),
  sitePlatformRepository.listAgentRunEvents(run.id, { limit: 5_000, order: "ascending" })
]);
if (!deployment) throw new Error(`Pinned sandbox deployment ${run.sandboxDeploymentId} is unavailable.`);
if (!retainedBuildInput) throw new Error(`Retained public build input ${retainedBuildInputId} is unavailable.`);

const store = configuredArtifactBlobStore();
const adoptedAssets: AssetRevisionRef[] = [];
for (const event of events.filter((item) => (
  item.kind === "tool_call"
  && item.name === "adopt_source_asset"
  && item.status === "succeeded"
))) {
  if (!event.payloadRef) throw new Error(`Asset adoption event ${event.sequence} is missing its retained payload.`);
  const blob = await store.get(event.payloadRef);
  if (!blob) throw new Error(`Asset adoption payload ${event.payloadRef} is unavailable.`);
  const payload = JSON.parse(blob.bytes.toString("utf8")) as { diagnosticResult?: { ok?: boolean; asset?: unknown } };
  if (payload.diagnosticResult?.ok !== true || !payload.diagnosticResult.asset) {
    throw new Error(`Asset adoption event ${event.sequence} has no successful retained asset reference.`);
  }
  adoptedAssets.push(payload.diagnosticResult.asset as AssetRevisionRef);
}

const assetsByRevision = new Map(retainedBuildInput.business.assets.map((asset) => [asset.revisionId, asset]));
for (const asset of adoptedAssets) assetsByRevision.set(asset.revisionId, asset);
const augmented = {
  ...structuredClone(retainedBuildInput),
  id: `input_reconstruction_${run.id.replace(/^run_/, "").slice(0, 32)}`,
  business: {
    ...structuredClone(retainedBuildInput.business),
    assets: [...assetsByRevision.values()]
  },
  assetRevisionIds: [...assetsByRevision.keys()].sort()
};
const { inputHash: _retainedInputHash, ...withoutHash } = augmented;
const effectiveBuildInput = sitePublicBuildInputSchema.parse({
  ...withoutHash,
  inputHash: sha256(stableJson(withoutHash))
});

const sourceDirectory = resolve(reconstructionDirectory, "workspace");
const retainedWorkspaceRevision = candidateVersion
  ? await sitePlatformRepository.getWorkspaceRevision(candidateVersion.workspaceRevisionId)
  : undefined;
if (candidateVersion && !retainedWorkspaceRevision) {
  throw new Error(`Retained workspace revision ${candidateVersion.workspaceRevisionId} is unavailable.`);
}
const retainedWorkspaceBlob = retainedWorkspaceRevision
  ? await store.get(workspaceSourceSidecarKey(retainedWorkspaceRevision.sourceArchiveKey))
  : undefined;
if (retainedWorkspaceRevision && !retainedWorkspaceBlob) {
  throw new Error(`Retained workspace source sidecar is unavailable for ${retainedWorkspaceRevision.id}.`);
}
const retainedWorkspaceSource = retainedWorkspaceBlob
  ? workspaceSourceSidecarSchema.parse(JSON.parse(retainedWorkspaceBlob.bytes.toString("utf8")))
  : undefined;
const sourceFiles = retainedWorkspaceSource && !useLocalReconstructionSource
  ? retainedWorkspaceSource.files.map(({ path, content }) => ({ path, content }))
  : await readReconstructedSourceFiles(sourceDirectory);
const sourceProvenance = retainedWorkspaceSource && !useLocalReconstructionSource
  ? { kind: "retained_candidate_sidecar" as const, workspaceRevisionId: retainedWorkspaceRevision?.id }
  : { kind: "local_reconstruction_directory" as const, directory: sourceDirectory };

async function readReconstructedSourceFiles(root: string) {
  const files: Array<{ path: string; content: string }> = [];
  const walk = async (directory: string, prefix = "") => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute, path);
      else if (entry.isFile() && /^src\/[a-zA-Z0-9_./-]+\.(?:css|ts|tsx|json)$/.test(path)) {
        files.push({ path, content: await readFile(absolute, "utf8") });
      }
    }
  };
  await walk(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}
const requestedSessionId = process.env.LODESTA_RECONSTRUCT_SESSION_ID?.trim();
const sessionId = requestedSessionId || `reconstruct_${randomUUID().replaceAll("-", "").slice(0, 48)}`;
if (!/^[a-z0-9_-]{1,80}$/.test(sessionId)) throw new Error("LODESTA_RECONSTRUCT_SESSION_ID is invalid.");
const emitPhase = (phase: string, detail: Record<string, unknown> = {}) => {
  process.stdout.write(`${JSON.stringify({ phase, sessionId, ...detail })}\n`);
};
emitPhase("starting", { repeatApplyAfterInspection, inspectionCount });
const sandbox = configuredSiteSandboxClientForDeployment(deployment);
let operationError: unknown;
let operationPhase = "bootstrap";
let result: Awaited<ReturnType<typeof runArtifactBrowserGate>> | undefined;
let appliedRevision: string | undefined;
let bootstrapDurationMs: number | undefined;
let applyDurationMs: number | undefined;
let repeatApplyDurationMs: number | undefined;
const inspectionDurationsMs: number[] = [];

try {
  const bootstrapStartedAt = performance.now();
  const bootstrapped = await sandbox.bootstrap(sessionId, effectiveBuildInput);
  bootstrapDurationMs = Math.round(performance.now() - bootstrapStartedAt);
  emitPhase("bootstrap_completed", { durationMs: bootstrapDurationMs });
  operationPhase = "initial_apply";
  const applyStartedAt = performance.now();
  const applied = await sandbox.apply(sessionId, bootstrapped.revision, sourceFiles);
  applyDurationMs = Math.round(performance.now() - applyStartedAt);
  appliedRevision = applied.revision;
  emitPhase("initial_apply_completed", { durationMs: applyDurationMs, revision: appliedRevision });
  operationPhase = "artifact_fetch";
  const authoredArtifact = await sandbox.getArtifact(sessionId);
  const availableRoutes = authoredArtifact.routes.map((route) => route.path);
  const missingRoutes = requestedRoutes.filter((route) => !availableRoutes.includes(route));
  if (missingRoutes.length) throw new Error(`Reconstructed artifact is missing routes: ${missingRoutes.join(", ")}.`);
  const prepared = prepareSiteArtifact({
    authoredArtifact,
    buildInput: effectiveBuildInput,
    runtimeSeriesId: effectiveBuildInput.capabilityConfiguration.trustedRuntimeSeries
  });
  for (let inspection = 1; inspection <= inspectionCount; inspection += 1) {
    operationPhase = `inspection_${inspection}`;
    emitPhase("inspection_started", { inspection });
    const inspectionStartedAt = performance.now();
    result = await runArtifactBrowserGate({
      prepared,
      buildInput: effectiveBuildInput,
      blobStore: store,
      capturePrefix: `diagnostic-reconstructions/${run.id}/inspection-${inspection}`,
      routePaths: requestedRoutes,
      captureMode: "review"
    });
    const inspectionDurationMs = Math.round(performance.now() - inspectionStartedAt);
    inspectionDurationsMs.push(inspectionDurationMs);
    emitPhase("inspection_completed", { inspection, durationMs: inspectionDurationMs });
  }
  if (!result) throw new Error("Reconstructed browser inspection did not produce a result.");
  if (repeatApplyAfterInspection) {
    operationPhase = "repeat_apply";
    emitPhase("repeat_apply_started");
    const repeatApplyStartedAt = performance.now();
    const repeated = await sandbox.apply(sessionId, appliedRevision, sourceFiles);
    repeatApplyDurationMs = Math.round(performance.now() - repeatApplyStartedAt);
    appliedRevision = repeated.revision;
    emitPhase("repeat_apply_completed", { durationMs: repeatApplyDurationMs, revision: appliedRevision });
  }

  operationPhase = "persist_captures";
  const captureDirectory = resolve(reconstructionDirectory, "captures");
  await mkdir(captureDirectory, { recursive: true });
  for (const [index, capture] of result.captures.entries()) {
    const routeLabel = capture.route === "/" ? "home" : capture.route.slice(1).replaceAll("/", "-");
    const filename = [
      String(index + 1).padStart(2, "0"),
      routeLabel,
      capture.viewport,
      capture.stage,
      capture.frame,
      basename(capture.key)
    ].filter(Boolean).join("-");
    await writeFile(resolve(captureDirectory, filename), capture.bytes);
  }

  const combinedFindings = [...prepared.findings, ...result.findings];
  const findingCounts = combinedFindings.reduce<Record<string, number>>((counts, finding) => {
    const key = `${finding.severity}:${finding.id}`;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    runId,
    sandboxDeploymentId: deployment.id,
    originalRunSandboxDeploymentId: run.sandboxDeploymentId,
    sandboxDeploymentOverridden: Boolean(sandboxDeploymentOverrideId),
    sandboxSessionId: sessionId,
    sandboxRevision: appliedRevision,
    bootstrapDurationMs,
    applyDurationMs,
    repeatApplyDurationMs,
    inspectionCount,
    inspectionDurationsMs,
    reconstructedPublicBuildInputId: effectiveBuildInput.id,
    sourceProvenance,
    adoptedAssets: adoptedAssets.map((asset) => ({
      assetId: asset.assetId,
      revisionId: asset.revisionId,
      kind: asset.kind,
      contentHash: asset.contentHash
    })),
    routes: requestedRoutes,
    captures: result.captures.map(({ bytes, ...capture }) => ({ ...capture, bytes: bytes.byteLength })),
    findingCounts,
    findings: combinedFindings,
    qualityMetrics: prepared.qualityMetrics,
    routesChecked: result.routesChecked,
    allRoutesChecked: result.allRoutesChecked,
    linksChecked: result.linksChecked
  };
  await writeFile(resolve(reconstructionDirectory, "browser-gate-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    runId,
    sandboxDeploymentId: deployment.id,
    sandboxRevision: appliedRevision,
    bootstrapDurationMs,
    applyDurationMs,
    repeatApplyDurationMs,
    inspectionCount,
    inspectionDurationsMs,
    sourceProvenance,
    routesChecked: result.routesChecked,
    captureCount: result.captures.length,
    findingCount: combinedFindings.length,
    findingCounts,
    reconstructionDirectory
  })}\n`);
} catch (error) {
  operationError = error;
  emitPhase("operation_failed", { operationPhase, error: errorSummary(error) });
}

let cleanupError: unknown;
try {
  emitPhase("cleanup_started");
  await sandbox.destroy(sessionId);
  emitPhase("cleanup_completed");
} catch (error) {
  cleanupError = error;
  emitPhase("cleanup_failed", { error: errorSummary(error) });
}

if (operationError && cleanupError) {
  throw new AggregateError([operationError, cleanupError], "Reconstructed render and sandbox cleanup both failed.");
}
if (operationError) throw operationError;
if (cleanupError) throw cleanupError;

function errorSummary(error: unknown) {
  if (!(error instanceof Error)) return { name: "Error", message: "Unknown diagnostic failure." };
  return {
    name: error.name,
    message: error.message.slice(0, 500),
    ...(error.cause instanceof Error
      ? { cause: { name: error.cause.name, message: error.cause.message.slice(0, 500) } }
      : {})
  };
}
