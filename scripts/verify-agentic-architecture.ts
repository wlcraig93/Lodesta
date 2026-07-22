import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const sourceRoots = ["app", "components", "lib", "packages", "workers", "scripts"];
const files = (await Promise.all(sourceRoots.map(walkSourceFiles))).flat().sort();
const errors: string[] = [];

const forbiddenFiles = [
  "lib/models.ts",
  "lib/repository.ts",
  "lib/store.ts",
  "lib/supabase/repository.ts",
  "lib/site-renderer-v3.tsx",
  "lib/site-compiler.ts",
  "lib/generation-pipeline.ts",
  "lib/generation-judge.ts",
  "lib/vertical-packs.ts",
  "lib/v3-editor.ts",
  "packages/site-capabilities/policy.ts",
  "scripts/site-v3-cutover.ts",
  "scripts/snapshot-site-v3-database.ts",
  "scripts/verify-site-v3-cutover.ts",
  "scripts/migrate-workspace-blobs.ts",
  "scripts/cleanup-workspace-rollback-copies.ts",
  "scripts/retire-workspace-rollback-after-site-v3.ts",
  "supabase/schema.sql"
];
for (const file of forbiddenFiles) {
  if (await exists(file)) errors.push(`${file}: deleted V3 module exists`);
}
for (const path of [
  "fixtures/generation-pipeline",
  "fixtures/market-benchmark",
  "app/admin/site-candidates",
  ".design/generated-site-v3",
  ".design/generated-site-quality",
  ".design/admin-generation-portal",
  ".design/design-system-gate-review",
  "docs/generation-pipeline-clean-break.md",
  "docs/website-generation-bakeoff-v1.md",
  "docs/agentic-site-v1-spike-results.md",
  "docs/agentic-site-workspace-v1-plan.md",
  "docs/cloudflare-sandbox-storage-cutover.md",
  "fixtures/generation-quality/austin-tireman-crawl.json",
  "public/fixture-assets/auto-repair-shop-hero-v1.jpg",
  "public/fixture-assets/auto-repair-shop-hero-v1.png",
  "app/sites/[slug]/md",
  "deploy/railway-worker.toml"
]) {
  if (await existsPath(path)) errors.push(`${path}: retired V3 path exists`);
}

if (await existsPath("app/_lodesta")) {
  errors.push("app/_lodesta is a private Next.js folder and cannot register the public /_lodesta route segment");
}
for (const path of [
  "app/%5Flodesta/assets/[revisionId]/route.ts",
  "app/%5Flodesta/runtime/[file]/route.ts",
  "app/%5Flodesta/runtime/patches/[file]/route.ts"
]) {
  if (!(await exists(path))) errors.push(`${path}: required encoded /_lodesta route handler is missing`);
}

const forbiddenArchitecture = /SiteVersionV3|GenerationInputSnapshotV1|site-renderer-v3|site-compiler|generation-pipeline|generation-judge|vertical-packs|modelFallbackPolicy|deterministic_fallback|\/admin\/site-candidates/;
const forbiddenCutoverContracts = /\b(?:SiteAgentRunV\d+|siteAgentRunV\d+Schema|SiteAgentSessionV\d+|SiteAgentTraceSpanV\d+|SiteEditObjectiveV\d+|ControlPlaneChangeRequestV\d+|OperatorQueueItemV\d+|VerticalDemandEventV\d+|ArtifactBlobAuditReportV\d+|ArtifactBlobOverlapV\d+|AgentModelSettingsSnapshotV\d+|Manager(?:RunRequest|ToolRuntime|Completion|Discussion|TraceEvent)V\d+|BusinessStateV2|businessStateV2Schema|SiteIntentV2|siteIntentV2Schema|SitePublicBuildInputV1|sitePublicBuildInputV1Schema|SitePublicBuildInputV2|sitePublicBuildInputV2Schema)\b|\bunsupported_vertical\b/;
const forbiddenOperationalStorage = /\b(?:site_agent_runs_v2|site_agent_trace_spans_v1|site_edit_objectives_v1|control_plane_change_requests_v2|vertical_demand_events_v1|site_agent_maintenance_leases_v1|workspace_storage_cutover)\b/;
for (const file of files) {
  if (file === "scripts/verify-agentic-architecture.ts") continue;
  const source = await readFile(file, "utf8");
  if (forbiddenArchitecture.test(source)) errors.push(`${file}: names deleted V3 generation architecture`);
  if (forbiddenCutoverContracts.test(source)) errors.push(`${file}: names a deleted pre-cutover agent or authority contract`);
  if (file !== "scripts/verify-supabase.ts" && forbiddenOperationalStorage.test(source)) {
    errors.push(`${file}: names deleted operational storage or maintenance state`);
  }
}

const applyRoute = await readFile("app/api/site-agent/runs/route.ts", "utf8");
if (/kind:\s*z\.|parsed\.data\.kind/.test(applyRoute)) errors.push("Apply API accepts a caller-selected task kind instead of creating the single canonical edit run");

const verticalNeutralRoots = [
  "packages/site-agent/",
  "packages/site-platform/",
  "packages/site-verification/",
  "packages/site-artifacts/",
  "packages/site-capabilities/",
  "packages/control-plane/",
  "packages/trusted-runtime/",
  "workers/runner.ts",
  "workers/site-sandbox/",
  "app/api/site-agent/",
  "app/api/site-versions/",
  "app/sites/",
  "app/preview/"
];
for (const file of files.filter((candidate) => verticalNeutralRoots.some((root) => candidate.startsWith(root)))) {
  const source = await readFile(file, "utf8");
  if (/\bauto_body\b|\bsynthetic_test_vertical\b|\bAutoBodyShop\b|\bautoBodyContextModule\b|\bingestAutoBodyWebsite\b|\bunderstandAutoBodyWebsite\b/.test(source)) {
    errors.push(`${file}: depends on a concrete vertical outside classification or the module registry`);
  }
}

const managerFiles = files.filter((file) => file.startsWith("packages/site-agent/"));
const managerSource = (await Promise.all(managerFiles.map((file) => readFile(file, "utf8")))).join("\n");
if (!managerSource.includes("class WebsiteManagerAgent")) errors.push("WebsiteManagerAgent is missing");
if ((managerSource.match(/class\s+\w+Agent\b/g) ?? []).length !== 1) errors.push("Exactly one authoring agent class must exist");
if (/set_site_plan|inspect_candidate|SiteEditObjective|parentSpanId|attemptIndex|replacementCount|anchorBudget|convergence|visualThesis|contentArchitecture|designRationale/i.test(managerSource)) {
  errors.push("Website manager retains deleted planner, objective, hierarchy, or convergence ceremony");
}
const simpleCutover = await readFile("supabase/migrations/202607220003_simple_site_authoring.sql", "utf8");
if (!simpleCutover.includes("simple_site_authoring_cutover_requires_empty_operational_state")
  || !simpleCutover.includes("drop table if exists site_edit_objectives_v1")
  || !simpleCutover.includes("create table site_agent_runs")
  || !simpleCutover.includes("create table site_agent_run_events")
  || /alter\s+table\s+site_agent_(?:runs|trace_spans|sessions)\s+rename/i.test(simpleCutover)
  || /update\s+site_agent_runs(?:_v2)?\s+set\s+(?:kind|schema_version|run)\b/i.test(simpleCutover)
  || /retired_request_events|retired_20260722/i.test(simpleCutover)) {
  errors.push("Simple-authoring migration must be an assert-empty clean cut without historical translation or archive tables");
}
const runEventRecorder = await readFile("packages/site-platform/run-events.ts", "utf8");
const lifecyclePolicy = await readFile("scripts/r2-lifecycle-policy.ts", "utf8");
if (!runEventRecorder.includes("agent-run-events/") || !lifecyclePolicy.includes("agent-run-events/") || !lifecyclePolicy.includes("lodesta-expire-agent-run-events-v1")) {
  errors.push("Flat run-event payloads are not covered by the one-day object lifecycle");
}
const authoringWorkflow = await readFile("packages/site-platform/workflow.ts", "utf8");
if (/expectedRoutes|route\.regression|currentWorkspaceRoutes/.test(authoringWorkflow)) {
  errors.push("Owner edits retain a hidden route-preservation gate instead of allowing exact intentional removals");
}
if (/unsupportedCapabilityDemands|unsupportedCapabilityMessage|taskKindForInstruction|preflightAndEnqueue/.test(authoringWorkflow)) {
  errors.push("Owner instructions pass through a deleted keyword classifier or preflight gate before reaching the model");
}
if (/reconcileExpiredRunEventPayloads|listExpiredAgentRunEventPayloads|clearAgentRunEventPayloads/.test(authoringWorkflow)) {
  errors.push("Application code duplicates the R2 run-event payload lifecycle");
}

const sandboxPackage = JSON.parse(await readFile("workers/site-sandbox/scaffold/package.json", "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const allowedSandboxDependencies = new Set(["@vitejs/plugin-react", "vite", "tsx", "typescript", "react", "react-dom", "@types/node", "@types/react", "@types/react-dom"]);
for (const dependency of [...Object.keys(sandboxPackage.dependencies ?? {}), ...Object.keys(sandboxPackage.devDependencies ?? {})]) {
  if (!allowedSandboxDependencies.has(dependency)) errors.push(`Sandbox has an unapproved dependency: ${dependency}`);
}

const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { scripts?: Record<string, string> };
for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
  for (const match of command.matchAll(/(?:^|\s)([A-Za-z0-9_./-]+\.(?:ts|tsx|js|mjs|sh))(?:\s|$)/g)) {
    if (!(await exists(match[1]))) errors.push(`package script ${name} references missing ${match[1]}`);
  }
  if (/generation|bakeoff|pilot|spike|benchmark/.test(name)) errors.push(`package script ${name} exposes retired generation machinery`);
}

const finalizer = await readFile("packages/site-verification/finalizer.ts", "utf8");
if (!finalizer.includes("site-build-artifact-v1") || !finalizer.includes("runtimeSeriesId")) errors.push("V4 artifact finalization contract is incomplete");
const globalCss = await readFile("app/globals.css", "utf8");
if (/\.public-site-v3\b|\.site-header-v3\b|\[data-section-template=|\.generation-review-workbench\b/.test(globalCss)) {
  errors.push("Global CSS contains deleted V3 renderer, template, or generation-review styles");
}
const publicRoute = await readFile("app/sites/[slug]/[[...path]]/route.ts", "utf8");
const previewRoute = await readFile("app/preview/[token]/[[...path]]/route.ts", "utf8");
if (/rewrite.*Paths/.test(`${publicRoute}\n${previewRoute}`)) errors.push("Finalized preview or public serving mutates retained artifact bytes");

const sandboxWorker = await readFile("workers/site-sandbox/src/index.ts", "utf8");
const sandboxConfig = await readFile("workers/site-sandbox/wrangler.jsonc", "utf8");
const artifactBroker = await readFile("workers/artifact-broker/src/index.ts", "utf8");
const artifactBrokerConfig = await readFile("workers/artifact-broker/wrangler.jsonc", "utf8");
const recoveryWatchdog = await readFile("workers/recovery-watchdog/src/index.ts", "utf8");
const recoveryWatchdogConfig = await readFile("workers/recovery-watchdog/wrangler.jsonc", "utf8");
const blobStore = await readFile("packages/site-artifacts/blob-store.ts", "utf8");
const maintenanceStore = await readFile("packages/site-artifacts/maintenance-store.ts", "utf8");
const platformRepository = await readFile("packages/platform-data/repository.ts", "utf8");
if (/\/v1\/blobs|ARTIFACT_BUCKET|WORKSPACE_BUCKET\.delete|bucket\.delete|bucket\.list/.test(sandboxWorker)) errors.push("Sandbox Worker exposes artifact-bucket blob authority");
if (!sandboxWorker.includes("WORKSPACE_BUCKET") || !sandboxWorker.includes('sleepAfter: "10m"')) errors.push("Sandbox Worker must use only the workspace bucket and retain the ten-minute sleep safety net");
if (!sandboxConfig.includes('"max_instances": 5') || !sandboxConfig.includes('"instance_type": "standard-2"') || !sandboxConfig.includes('"binding": "WORKSPACE_BUCKET"')) errors.push("Sandbox deployment must cap standard-2 containers at five against the workspace bucket");
if (!artifactBroker.includes('["PUT", "GET", "HEAD"]') || /request\.method === "DELETE"|bucket\.delete|bucket\.list/.test(artifactBroker)) errors.push("Artifact broker must expose exact immutable read/write/head only");
if (!artifactBrokerConfig.includes('"binding": "ARTIFACT_BUCKET"')) errors.push("Artifact broker is not bound to the artifact bucket");
if (!recoveryWatchdog.includes("scheduled(") || !recoveryWatchdogConfig.includes('"*/15 * * * *"')) errors.push("Recovery watchdog is missing its fifteen-minute scheduled handler");
if (/R2Bucket|DurableObject|Container|Queue/.test(`${recoveryWatchdog}\n${recoveryWatchdogConfig}`)) errors.push("Recovery watchdog must remain stateless and container-free");
const appStoreInterface = blobStore.match(/export interface ArtifactBlobStore \{([\s\S]*?)\n\}/)?.[1] ?? "";
if (/delete|listPage/.test(appStoreInterface)) errors.push("Application artifact store exposes maintenance deletion or inventory");
if (!maintenanceStore.includes("R2S3MaintenanceStore") || !maintenanceStore.includes('"LODESTA_R2_MAINTENANCE"') || !maintenanceStore.includes('"LODESTA_R2_AUDIT"')) errors.push("R2 audit and mutation credentials are not isolated in the Node-only maintenance client");
if (!platformRepository.includes("sandbox_id: value.sandboxId ?? null")
  || !platformRepository.includes("sandbox_last_started_at: value.sandboxLastStartedAt ?? null")) {
  errors.push("Supabase session persistence does not explicitly clear destroyed sandbox lifecycle fields");
}
if (await existsPath("workers/site-sandbox/src/blob-inventory.ts")) errors.push("Retired sandbox inventory route exists");
for (const file of files) {
  const source = await readFile(file, "utf8");
  if (/LODESTA_R2_BRIDGE_(?:URL|TOKEN)/.test(source)) errors.push(`${file}: uses retired combined R2 bridge credentials`);
}

if (errors.length) throw new Error(`Agentic architecture verification failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
console.log(JSON.stringify({ ok: true, filesChecked: files.length, authoringAgents: 1, verticalNeutralRoots: verticalNeutralRoots.length }));

async function exists(path: string) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function existsPath(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function walkSourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const values = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return walkSourceFiles(path);
    return entry.isFile() && /\.(?:ts|tsx|js|mjs)$/.test(entry.name) ? [path] : [];
  }));
  return values.flat();
}
