import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { LocalSitePlatformRepository } from "../packages/platform-data";
import { LocalArtifactBlobStore } from "../packages/site-artifacts";
import { SiteAuthoringWorkflow } from "../packages/site-platform/workflow";
import {
  readDevelopmentSandboxReceipt,
  readDevelopmentSandboxToken,
  SiteSandboxClient
} from "../packages/site-sandbox";

const templateSiteId = required("LODESTA_TREATMENT_TEMPLATE_SITE_ID");
const treatmentName = required("LODESTA_TREATMENT_NAME");
const outputInput = required("LODESTA_TREATMENT_OUTPUT");
const modelId = process.env.LODESTA_TREATMENT_MODEL_ID?.trim() || "gpt-5.6-luna";
const maxCostUsd = Number(process.env.LODESTA_TREATMENT_MAX_COST_USD ?? "0.50");
if (process.env.LODESTA_REPOSITORY !== "local") {
  throw new Error("Retained-site authoring treatments require LODESTA_REPOSITORY=local.");
}
if (process.env.LODESTA_DEV_SANDBOX !== "1") {
  throw new Error("Retained-site authoring treatments require LODESTA_DEV_SANDBOX=1.");
}
if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > 5) {
  throw new Error("LODESTA_TREATMENT_MAX_COST_USD must be greater than 0 and no more than 5.");
}
const root = resolve(process.cwd());
const allowedRoot = resolve(root, ".design");
const outputPath = resolve(root, outputInput);
const repositoryPath = resolve(root, required("LODESTA_LOCAL_DATA_PATH"));
const blobRoot = resolve(root, required("LODESTA_LOCAL_BLOB_DIR"));
if (!outputPath.startsWith(`${allowedRoot}${sep}`)) {
  throw new Error("Treatment evidence must stay under .design/.");
}
if (!repositoryPath.startsWith(`${allowedRoot}${sep}`) || !blobRoot.startsWith(`${allowedRoot}${sep}`)) {
  throw new Error("Treatment repository and blob storage must stay under .design/.");
}
const repository = new LocalSitePlatformRepository(repositoryPath);
const sandboxSlot = process.env.LODESTA_TREATMENT_SANDBOX_SLOT?.trim() === "blue" ? "blue" : "green";
const receipt = readDevelopmentSandboxReceipt(sandboxSlot);
const sandbox = new SiteSandboxClient(receipt.url, readDevelopmentSandboxToken(sandboxSlot));
const control = await repository.getSandboxControl();
const pinnedDeployment = control
  ? await repository.getSandboxDeployment(control.activeDeploymentId)
  : undefined;
if (!pinnedDeployment) throw new Error("Treatment repository is missing its local sandbox deployment record.");
const workflow = new SiteAuthoringWorkflow(
  repository,
  new LocalArtifactBlobStore(blobRoot),
  sandbox,
  undefined,
  undefined,
  undefined,
  pinnedDeployment
);

const idempotencyKey = process.env.LODESTA_TREATMENT_IDEMPOTENCY_KEY?.trim()
  || `retained-treatment-${treatmentName}`;
const slug = process.env.LODESTA_TREATMENT_SLUG?.trim();
const startedAt = new Date().toISOString();
let runId: string | undefined;
let progress: ReturnType<typeof setInterval> | undefined;

try {
  const bootstrap = await workflow.bootstrapFromRetainedSite({
    templateSiteId,
    idempotencyKey,
    reportingTimezone: "UTC",
    ...(slug ? { slug } : {}),
    modelRoute: { apiProvider: "openai", modelId },
    maxCostUsd
  });
  runId = bootstrap.run.id;
  emit({
    event: "retained_treatment_started",
    treatmentName,
    runId,
    siteId: bootstrap.site.id,
    modelId,
    maxCostUsd
  });
  progress = setInterval(async () => {
    const run = runId ? await repository.getAgentRun(runId).catch(() => undefined) : undefined;
    if (!run) return;
    emit({
      event: "retained_treatment_progress",
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
  const [artifact, version, events] = await Promise.all([
    completed.outputArtifactId
      ? repository.getBuildArtifact(completed.outputArtifactId)
      : undefined,
    completed.candidateVersionId
      ? repository.getSiteVersion(completed.candidateVersionId)
      : undefined,
    repository.listAgentRunEvents(runId, { limit: 2_000 })
  ]);
  const result = {
    schemaVersion: 1,
    kind: "retained-site-authoring-treatment",
    treatmentName,
    generatedAt: new Date().toISOString(),
    startedAt,
    templateSiteId,
    site: bootstrap.site,
    run: completed,
    version,
    artifact,
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
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  emit({
    event: "retained_treatment_complete",
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
    kind: "retained-site-authoring-treatment",
    treatmentName,
    generatedAt: new Date().toISOString(),
    startedAt,
    templateSiteId,
    run,
    error: error instanceof Error ? error.message : String(error)
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  emit({
    event: "retained_treatment_failed",
    treatmentName,
    resultPath: outputPath,
    runId: runId ?? null,
    status: run?.status ?? "failed",
    failureCode: run?.failureCode ?? null,
    error: result.error
  });
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
