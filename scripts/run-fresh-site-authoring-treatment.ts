import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { sha256, stableJson } from "../packages/business-data";
import { LocalSitePlatformRepository } from "../packages/platform-data";
import { LocalArtifactBlobStore } from "../packages/site-artifacts";
import { SiteAuthoringWorkflow } from "../packages/site-platform/workflow";
import {
  siteSandboxControlSchema,
  siteSandboxDeploymentSchema,
  type SiteSandboxSlot
} from "../packages/site-contracts";
import {
  developmentSandboxDeploymentMatchesCheckout,
  readDevelopmentSandboxReceipt,
  readDevelopmentSandboxToken,
  SiteSandboxClient
} from "../packages/site-sandbox";

const sourceUrl = new URL(required("LODESTA_TREATMENT_SOURCE_URL"));
const treatmentName = required("LODESTA_TREATMENT_NAME");
const outputInput = required("LODESTA_TREATMENT_OUTPUT");
const modelId = process.env.LODESTA_TREATMENT_MODEL_ID?.trim() || "gpt-5.6-luna";
const maxCostUsd = Number(process.env.LODESTA_TREATMENT_MAX_COST_USD ?? "0.50");
const ownerId = process.env.LODESTA_TREATMENT_OWNER_ID?.trim() || "00000000-0000-4000-8000-000000000001";
if (process.env.LODESTA_REPOSITORY !== "local") throw new Error("Fresh-site treatments require LODESTA_REPOSITORY=local.");
if (process.env.LODESTA_DEV_SANDBOX !== "1") throw new Error("Fresh-site treatments require LODESTA_DEV_SANDBOX=1.");
if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > 5) {
  throw new Error("LODESTA_TREATMENT_MAX_COST_USD must be greater than 0 and no more than 5.");
}

const root = resolve(process.cwd());
const allowedRoot = resolve(root, ".design");
const outputPath = resolve(root, outputInput);
const repositoryPath = resolve(root, required("LODESTA_LOCAL_DATA_PATH"));
const blobRoot = resolve(root, required("LODESTA_LOCAL_BLOB_DIR"));
for (const path of [outputPath, repositoryPath, blobRoot]) {
  if (!path.startsWith(`${allowedRoot}${sep}`)) throw new Error("Fresh-site treatment evidence must stay under .design/.");
}
await Promise.all([mkdir(dirname(outputPath), { recursive: true }), mkdir(dirname(repositoryPath), { recursive: true }), mkdir(blobRoot, { recursive: true })]);

const repository = new LocalSitePlatformRepository(repositoryPath);
const sandboxSlot: SiteSandboxSlot = process.env.LODESTA_TREATMENT_SANDBOX_SLOT?.trim() === "blue" ? "blue" : "green";
const deploymentForSlot = (slot: SiteSandboxSlot) => {
  const slotReceipt = readDevelopmentSandboxReceipt(slot, root);
  return siteSandboxDeploymentSchema.parse({
    schemaVersion: 1,
    id: `sandbox_deployment_${sha256(stableJson({
      slot,
      workerVersionId: slotReceipt.workerVersionId,
      releaseSha: slotReceipt.releaseSha,
      imageDigest: slotReceipt.imageDigest,
      manifest: slotReceipt.sandboxManifest
    })).slice("sha256:".length, "sha256:".length + 24)}`,
    slot,
    workerVersionId: slotReceipt.workerVersionId,
    releaseSha: slotReceipt.releaseSha,
    imageDigest: slotReceipt.imageDigest,
    credentialSlot: slot,
    manifest: slotReceipt.sandboxManifest,
    createdAt: slotReceipt.deployedAt
  });
};
const deployment = deploymentForSlot(sandboxSlot);
if (!await developmentSandboxDeploymentMatchesCheckout(deployment, root)) {
  throw new Error(`development_sandbox_checkout_mismatch:${sandboxSlot}`);
}
await repository.saveSandboxDeployment(deployment);
if (!await repository.getSandboxControl()) {
  const blueDeployment = sandboxSlot === "blue" ? deployment : deploymentForSlot("blue");
  if (blueDeployment.id !== deployment.id) await repository.saveSandboxDeployment(blueDeployment);
  await repository.saveSandboxControl(siteSandboxControlSchema.parse({
    schemaVersion: 1,
    id: "production",
    blueDeploymentId: blueDeployment.id,
    ...(sandboxSlot === "green" ? { greenDeploymentId: deployment.id } : {}),
    activeDeploymentId: deployment.id,
    updatedAt: new Date().toISOString()
  }));
}

const selectedReceipt = readDevelopmentSandboxReceipt(sandboxSlot, root);
const sandbox = new SiteSandboxClient(selectedReceipt.url, readDevelopmentSandboxToken(sandboxSlot));
const workflow = new SiteAuthoringWorkflow(
  repository,
  new LocalArtifactBlobStore(blobRoot),
  sandbox,
  undefined,
  undefined,
  undefined,
  deployment
);
const idempotencyKey = process.env.LODESTA_TREATMENT_IDEMPOTENCY_KEY?.trim() || `fresh-treatment-${treatmentName}`;
const slug = process.env.LODESTA_TREATMENT_SLUG?.trim();
const startedAt = new Date().toISOString();
let runId: string | undefined;
let progress: ReturnType<typeof setInterval> | undefined;

try {
  const bootstrap = await workflow.bootstrapFromUrl({
    url: sourceUrl.href,
    ownerId,
    idempotencyKey,
    reportingTimezone: "UTC",
    ...(slug ? { slug } : {}),
    modelRoute: { apiProvider: "openai", modelId },
    maxCostUsd
  });
  runId = bootstrap.run.id;
  emit({ event: "fresh_treatment_started", treatmentName, runId, siteId: bootstrap.site.id, sourceUrl: sourceUrl.href, modelId, maxCostUsd });
  progress = setInterval(async () => {
    const run = runId ? await repository.getAgentRun(runId).catch(() => undefined) : undefined;
    if (!run) return;
    emit({
      event: "fresh_treatment_progress",
      treatmentName,
      status: run.status,
      stage: run.stage,
      costUsd: run.usage.costUsd,
      durationMs: run.usage.durationMs,
      executionNumber: run.executionNumber,
      failureCode: run.failureCode ?? null
    });
  }, 30_000);
  progress.unref();

  const completed = await workflow.executeRunAndFinalize(runId);
  if (progress) clearInterval(progress);
  const completedBuildInput = await repository.getPublicBuildInput(completed.publicBuildInputId);
  const [artifact, version, events, sourcePageGroups] = await Promise.all([
    completed.outputArtifactId ? repository.getBuildArtifact(completed.outputArtifactId) : undefined,
    completed.candidateVersionId ? repository.getSiteVersion(completed.candidateVersionId) : undefined,
    repository.listAgentRunEvents(runId, { limit: 2_000 }),
    Promise.all((completedBuildInput?.sourceSnapshotIds ?? []).map((sourceSnapshotId) => repository.listSourceSnapshotPages(sourceSnapshotId)))
  ]);
  const sourcePages = sourcePageGroups.flat();
  const result = {
    schemaVersion: 1,
    kind: "fresh-site-authoring-treatment",
    treatmentName,
    generatedAt: new Date().toISOString(),
    startedAt,
    sourceUrl: sourceUrl.href,
    site: bootstrap.site,
    run: completed,
    version,
    artifact,
    sourceEvidence: {
      pages: sourcePages.length,
      legalPaths: sourcePages.filter((page) => /(?:^|\/)(?:privacy|terms|legal|cookie|accessibility)(?:[-/]|$)/i.test(page.path)).map((page) => page.path)
    },
    operationalEvidence: {
      modelRequests: events.filter((event) => event.kind === "model_request" && event.status === "succeeded").length,
      inspections: events.filter((event) => event.kind === "inspection" && event.name === "inspect_site").length,
      finishAttempts: events.filter((event) => event.kind === "inspection" && event.name === "finish").length,
      builds: events.filter((event) => event.kind === "build").map((event) => ({
        status: event.status,
        errorCode: event.errorCode ?? null,
        submissionAttempts: event.summary.submissionAttempts ?? null,
        replayed: event.summary.replayed ?? null,
        durationMs: event.summary.durationMs ?? null
      }))
    }
  };
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  emit({
    event: "fresh_treatment_complete",
    treatmentName,
    resultPath: outputPath,
    runId,
    status: completed.status,
    costUsd: completed.usage.costUsd,
    durationMs: completed.usage.durationMs,
    versionId: version?.id ?? null,
    artifactId: artifact?.id ?? null,
    hardGate: artifact?.qa.hardGate ?? null,
    routes: artifact?.routes.length ?? 0
  });
  if (completed.status !== "succeeded" || artifact?.qa.hardGate !== "passed") process.exitCode = 1;
} catch (error) {
  if (progress) clearInterval(progress);
  const run = runId ? await repository.getAgentRun(runId).catch(() => undefined) : undefined;
  const result = {
    schemaVersion: 1,
    kind: "fresh-site-authoring-treatment",
    treatmentName,
    generatedAt: new Date().toISOString(),
    startedAt,
    sourceUrl: sourceUrl.href,
    run,
    error: error instanceof Error ? error.message : String(error)
  };
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  emit({ event: "fresh_treatment_failed", treatmentName, resultPath: outputPath, runId: runId ?? null, status: run?.status ?? "failed", failureCode: run?.failureCode ?? null, error: result.error });
  process.exitCode = 1;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function emit(value: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
