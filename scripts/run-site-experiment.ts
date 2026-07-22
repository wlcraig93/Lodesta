import "./load-env";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { sha256, stableJson } from "../packages/business-data";
import { taskSkillFor, websiteManagerPromptVersion } from "../packages/site-agent";
import { configuredArtifactBlobStore } from "../packages/site-artifacts";
import { sitePlatformVersionManifest } from "../packages/site-contracts/platform-versions";
import type { PlatformSiteRecord, SiteAgentRun, SiteBuildArtifactV1, SitePublicBuildInputV3, SiteVersionV4 } from "../packages/site-contracts";
import { sitePlatformRepository } from "../packages/platform-data";
import { SiteAuthoringWorkflow } from "../packages/site-platform";

const execFileAsync = promisify(execFile);
const sourceUrl = requiredSourceUrl();
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const attemptId = `experiment_${timestamp}_${suffix}`;
const attemptDir = join(".data", "site-experiments", attemptId);
const startedAt = new Date().toISOString();
const workflow = new SiteAuthoringWorkflow();
const skill = taskSkillFor("initial_build");
const sourceRevision = await readSourceRevision();
const origin = (process.env.LODESTA_APP_ORIGIN ?? process.env.LODESTA_API_URL ?? "http://127.0.0.1:4330").replace(/\/$/, "");

let stage = "initializing";
let site: PlatformSiteRecord | undefined;
let buildInput: SitePublicBuildInputV3 | undefined;
let run: SiteAgentRun | undefined;
let version: SiteVersionV4 | undefined;
let artifact: SiteBuildArtifactV1 | undefined;

await mkdir(attemptDir, { recursive: true });
await writeFile(join(attemptDir, "notes.md"), notesTemplate({ sourceUrl, attemptId, sourceRevision }));

try {
  stage = "ingesting";
  progress(stage, { sourceUrl });
  const bootstrapped = await workflow.bootstrapFromUrl({
    url: sourceUrl,
    ownerId: `experiment_${suffix}`,
    mode: "experimental",
    slug: `site-experiment-${suffix}`
  });
  site = bootstrapped.site;
  buildInput = bootstrapped.buildInput;
  run = bootstrapped.run;
  await writeJson(join(attemptDir, "public-input.json"), buildInput);

  stage = "generating";
  progress(stage, { siteId: site.id, runId: run.id });
  run = await workflow.executeRunAndFinalize(run.id);
  if (run.status !== "succeeded" || !run.candidateVersionId) {
    throw new Error(run.failureReason ?? `Initial generation ended with status ${run.status}.`);
  }

  version = await sitePlatformRepository.getSiteVersion(run.candidateVersionId);
  if (!version) throw new Error("The successful run did not retain its candidate version.");
  artifact = await sitePlatformRepository.getBuildArtifact(version.artifactId);
  if (!artifact) throw new Error("The successful run did not retain its build artifact.");

  stage = "retaining_outputs";
  progress(stage, { versionId: version.id, artifactId: artifact.id });
  await copyCaptures(artifact.qa.screenshotKeys, attemptDir);
  const completedAt = new Date().toISOString();
  const paths = outputPaths(site, version, attemptDir, origin);
  const report = {
    schemaVersion: "site-experiment-report-v1",
    attemptId,
    status: "succeeded",
    stage: "completed",
    sourceUrl,
    startedAt,
    completedAt,
    durationMs: Date.parse(completedAt) - Date.parse(startedAt),
    site: { id: site.id, businessId: site.businessId, slug: site.slug, status: site.status },
    run: runSummary(run),
    candidate: {
      versionId: version.id,
      artifactId: artifact.id,
      artifactHash: artifact.artifactHash,
      routes: artifact.routes.map((route) => route.path)
    },
    provenance: experimentProvenance({ sourceRevision, run, buildInput, artifact }),
    verification: {
      hardGate: artifact.qa.hardGate,
      findings: artifact.qa.findings,
      screenshotKeys: artifact.qa.screenshotKeys,
      routesChecked: artifact.qa.routesChecked,
      linksChecked: artifact.qa.linksChecked
    },
    diagnostics: await runDiagnostics(run.id),
    paths
  };
  const reportPath = join(attemptDir, "report.json");
  await writeJson(reportPath, report);
  process.stdout.write(`${JSON.stringify({ ok: true, reportPath, ...paths, siteId: site.id, versionId: version.id }, null, 2)}\n`);
} catch (error) {
  const completedAt = new Date().toISOString();
  const paths = site ? outputPaths(site, version, attemptDir, origin) : { reportDirectory: attemptDir };
  const report = {
    schemaVersion: "site-experiment-report-v1",
    attemptId,
    status: "failed",
    stage,
    sourceUrl,
    startedAt,
    completedAt,
    durationMs: Date.parse(completedAt) - Date.parse(startedAt),
    site: site ? { id: site.id, businessId: site.businessId, slug: site.slug, status: site.status } : undefined,
    run: run ? runSummary(run) : undefined,
    candidate: version || artifact ? {
      versionId: version?.id,
      artifactId: artifact?.id,
      artifactHash: artifact?.artifactHash,
      routes: artifact?.routes.map((route) => route.path)
    } : undefined,
    provenance: experimentProvenance({ sourceRevision, run, buildInput, artifact }),
    verification: artifact ? {
      hardGate: artifact.qa.hardGate,
      findings: artifact.qa.findings,
      screenshotKeys: artifact.qa.screenshotKeys,
      routesChecked: artifact.qa.routesChecked,
      linksChecked: artifact.qa.linksChecked
    } : undefined,
    failure: { message: boundedError(error) },
    diagnostics: await runDiagnostics(run?.id),
    paths
  };
  const reportPath = join(attemptDir, "report.json");
  await writeJson(reportPath, report);
  process.stderr.write(`${JSON.stringify({ ok: false, reportPath, stage, error: boundedError(error), ...paths }, null, 2)}\n`);
  process.exitCode = 1;
}

function requiredSourceUrl() {
  const raw = process.argv.find((argument) => argument.startsWith("--url="))?.slice("--url=".length);
  if (!raw) throw new Error("Usage: experiment:site -- --url=https://business.example/");
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Site experiments require an HTTPS source URL.");
  url.hash = "";
  return url.toString();
}

function experimentProvenance(input: {
  sourceRevision: Awaited<ReturnType<typeof readSourceRevision>>;
  run?: SiteAgentRun;
  buildInput?: SitePublicBuildInputV3;
  artifact?: SiteBuildArtifactV1;
}) {
  return {
    sourceRevision: input.sourceRevision,
    modelId: input.run?.modelId,
    skillVersions: input.run?.skillVersions,
    skillContentHash: sha256(stableJson(skill)),
    managerPromptVersion: websiteManagerPromptVersion,
    platformVersions: sitePlatformVersionManifest,
    publicInputHash: input.buildInput?.inputHash,
    artifactHash: input.artifact?.artifactHash,
    artifactToolchainVersion: input.artifact?.toolchainVersion,
    artifactSandboxImageDigest: input.artifact?.sandboxImageDigest
  };
}

function runSummary(value: SiteAgentRun) {
  return {
    id: value.id,
    status: value.status,
    stage: value.stage,
    modelId: value.modelId,
    skillVersions: value.skillVersions,
    publicBuildInputId: value.publicBuildInputId,
    outputRevisionId: value.outputRevisionId,
    outputArtifactId: value.outputArtifactId,
    candidateVersionId: value.candidateVersionId,
    failureReason: value.failureReason,
    usage: value.usage
  };
}

async function runDiagnostics(runId?: string) {
  if (!runId) return [];
  try {
    return (await sitePlatformRepository.listAgentRunEvents(runId, { limit: 500 })).map((event) => ({
      sequence: event.sequence,
      kind: event.kind,
      name: event.name,
      status: event.status,
      errorCode: event.errorCode,
      summary: event.summary,
      payloadRef: event.payloadRef,
      payloadHash: event.payloadHash,
      startedAt: event.startedAt,
      completedAt: event.completedAt
    }));
  } catch (error) {
    return [{ kind: "diagnostic_collection", status: "failed", error: boundedError(error) }];
  }
}

async function copyCaptures(keys: string[], directory: string) {
  if (!keys.length) return;
  const captureDir = join(directory, "captures");
  await mkdir(captureDir, { recursive: true });
  const store = configuredArtifactBlobStore();
  for (const [index, key] of keys.entries()) {
    const blob = await store.get(key);
    if (!blob) throw new Error(`Retained capture is missing: ${key}`);
    await writeFile(join(captureDir, `${String(index + 1).padStart(2, "0")}-${basename(key)}`), blob.bytes);
  }
}

function outputPaths(siteValue: PlatformSiteRecord, versionValue: SiteVersionV4 | undefined, directory: string, appOrigin: string) {
  const cleanupConfirmation = `delete-experimental:${siteValue.id}:${siteValue.businessId}`;
  return {
    reportDirectory: directory,
    workspaceUrl: `${appOrigin}/workspace/${siteValue.slug}/website`,
    previewUrl: versionValue ? `${appOrigin}/api/site-versions/${versionValue.id}/artifact/` : undefined,
    cleanupCommand: `npm run cleanup:experimental -- --site=${siteValue.id} --business=${siteValue.businessId} --confirm=${cleanupConfirmation} --local-path=${directory}`
  };
}

async function readSourceRevision() {
  const railwayCommit = process.env.RAILWAY_GIT_COMMIT_SHA?.trim();
  const localCommit = await gitOutput(["rev-parse", "HEAD"]);
  const localStatus = await gitOutput(["status", "--porcelain"]);
  return {
    commit: railwayCommit || localCommit || "unknown",
    commitSource: railwayCommit ? "railway" : localCommit ? "git" : "unavailable",
    workingTree: localStatus === undefined ? "unavailable" : localStatus ? "dirty" : "clean"
  };
}

async function gitOutput(args: string[]) {
  try {
    const result = await execFileAsync("git", args, { cwd: process.cwd(), timeout: 5_000 });
    return result.stdout.trim();
  } catch {
    return undefined;
  }
}

function notesTemplate(input: { sourceUrl: string; attemptId: string; sourceRevision: Awaited<ReturnType<typeof readSourceRevision>> }) {
  return `# Experiment notes\n\nSource: ${input.sourceUrl}\nAttempt: ${input.attemptId}\nCommit: ${input.sourceRevision.commit}\nWorking tree: ${input.sourceRevision.workingTree}\n\n## Observations\n\n`;
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function progress(nextStage: string, detail: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify({ type: "site_experiment_progress", attemptId, stage: nextStage, at: new Date().toISOString(), ...detail })}\n`);
}

function boundedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 4_000 ? `${message.slice(0, 3_980)}... [truncated]` : message;
}
