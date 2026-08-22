import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

const codeRoots = ["app", "components", "lib", "packages", "workers", "scripts"];
const sourceFiles = (await Promise.all(codeRoots.map(walk))).flat();
const sources = await Promise.all(sourceFiles.map(async (path) => ({ path, source: await readFile(path, "utf8") })));
const labelFiles = [
  ...(await Promise.all([...codeRoots, "config", "docs", "supabase/migrations", ".github"].map(walkText))).flat(),
  "package.json",
  ".env.example"
];
const labelSources = await Promise.all(labelFiles.map(async (path) => ({ path, source: await readFile(path, "utf8") })));
const baseline = await readFile("supabase/migrations/202607230001_canonical_baseline.sql", "utf8");

for (const path of [
  "app/(marketing)/claim/[slug]/page.tsx", "app/api/claim/route.ts", "app/api/stripe/webhook/route.ts",
  "app/api/billing/portal/route.ts", "lib/billing.ts", "lib/claim-ownership.ts",
  "lib/claim-verification-challenge.ts", "lib/stripe-webhook.ts", "scripts/run-site-experiment.ts",
  "app/api/mcp/route.ts", "packages/site-authoring-mcp", "docs/site-authoring-mcp.md",
  "scripts/manage-site-authoring-mcp-credentials.ts", "scripts/verify-site-authoring-mcp.ts",
  "scripts/spike-site-authoring-mcp-connectivity.ts",
  "integrations/codex/skills/lodesta-site-authoring",
  "integrations/codex/lodesta-owner.config.toml.example"
]) await assertMissing(path);

for (const { path, source } of sources) {
  const versioned = versionedLodestaDeclarations(path, source);
  assert.deepEqual(versioned, [], `${path} declares version-suffixed Lodesta identifiers: ${versioned.join(", ")}`);
}
for (const { path, source } of labelSources) {
  const unexpected = numberedInternalLabels(source).filter((label) => !allowedBoundaryLabel(path, label));
  assert.deepEqual(unexpected, [], `${path} contains numbered internal labels: ${unexpected.join(", ")}`);
}
const allowedVersionedFiles = new Set([
  "docs/canonical-v4-consolidation-plan.md",
  "docs/decisions/2026-08-21-canonical-v4-glyph-runtime-consolidation.md",
  "packages/trusted-runtime/site-runtime-v4.js",
  "supabase/migrations/202607270001_website_health_report_v2.sql"
]);
const unexpectedVersionedFiles = labelFiles.filter((path) => /(?:^|[/_.-])v\d+(?:\.\d+)?(?:[/_.-]|$)/i.test(path) && !allowedVersionedFiles.has(path));
assert.deepEqual(unexpectedVersionedFiles, [], `Version-numbered internal filenames remain: ${unexpectedVersionedFiles.join(", ")}`);
assert.deepEqual(versionedLodestaDeclarations("fixture.ts", `
  import { ListObjectsV2Command } from "@aws-sdk/client-s3";
  const sourceV4 = [];
  const sourceV6 = [];
  const targetV4 = [];
  const targetV6 = [];
`), [], "Imported SDK names and ordinary IPv4/IPv6 locals must not be treated as Lodesta contract declarations.");
for (const table of [
  "jobs", "claims"
]) assert(!new RegExp(`create table ${table}\\b`).test(baseline), `Baseline declares retired table ${table}.`);

const workflow = await readFile("packages/site-platform/workflow.ts", "utf8");
assert(!workflow.includes("ExistingSourceCollisionError") && !workflow.includes("existingSourcePolicy"), "Source collision reuse remains in authoring.");
assert(!workflow.includes('mode?: "draft" | "experimental"'), "Experimental authoring mode remains.");
assert(!workflow.includes("publishAfterSuccess"), "A run-level hidden auto-publication path remains in authoring.");
const bootstrapBody = workflow.match(/async bootstrapFromUrl\([\s\S]*?\n  }\n\n  async prepareExternalOwnerSite/)?.[0] ?? "";
const enqueueBody = workflow.match(/async enqueueRun\([\s\S]*?\n  }\n\n  async enqueueEdit/)?.[0] ?? "";
assert(
  !bootstrapBody.includes("ensureRuntime")
  && !enqueueBody.includes("configuredSiteSandboxRuntimeForDeployment")
  && !enqueueBody.includes("developmentSandboxDeploymentMatchesCheckout"),
  "Private project creation is still blocked on authoring runtime readiness."
);
const accessSource = await readFile("lib/page-access.ts", "utf8");
assert(accessSource.includes("site.ownerUserId === userId") && !accessSource.includes("ownerEmail"), "Site access is not exact user-ID ownership.");
const publication = await readFile("packages/site-platform/candidate-integrity.ts", "utf8");
const releaseVerification = await readFile("packages/site-platform/release-verification.ts", "utf8");
assert(!publication.includes("score") && !publication.includes("objective_qa"), "Candidate integrity contains subjective readiness scoring.");
assert(
  publication.includes("artifactContentHash")
  && releaseVerification.includes("verifyBlob")
  && releaseVerification.includes("sha256(read.blob.bytes)")
  && releaseVerification.includes("workspaceSourceSidecarSchema"),
  "Candidate integrity does not verify retained bytes, workspace provenance, and the artifact manifest."
);
const prelaunchReset = await readFile("scripts/reset-prelaunch-site-authoring.ts", "utf8");
assert(
  prelaunchReset.indexOf("const removedPrelaunchTables") < prelaunchReset.indexOf("if (!options.apply)"),
  "The prelaunch reset table allowlist is initialized after top-level execution."
);
assert(
  prelaunchReset.includes('"website_assessments"')
  && prelaunchReset.includes('"website_assessment_jobs"')
  && prelaunchReset.includes("siteAssessments")
  && prelaunchReset.includes("siteAssessmentJobs"),
  "The prelaunch reset does not inventory and remove generated-site assessment dependencies."
);
assert(
  prelaunchReset.includes('"site_agent_workspace_checkpoints"')
  && prelaunchReset.includes('"analytics_collection_daily"')
  && prelaunchReset.includes('"source_snapshot_mirror_references"')
  && prelaunchReset.indexOf('updateAll(database, "site_agent_runs", { resume_checkpoint_id: null }')
    < prelaunchReset.indexOf('["site_agent_workspace_checkpoints", "id"]')
  && prelaunchReset.indexOf('["site_agent_workspace_checkpoints", "id"]')
    < prelaunchReset.indexOf('["site_agent_runs", "id"]'),
  "The prelaunch reset does not resolve the live checkpoint/run cycle and three retained dependencies in FK order."
);
assert(
  !prelaunchReset.includes('selectAll(database, "prospect_observations"')
  && prelaunchReset.includes('selectAll(database, "prospect_reports", "id,assessment_id")'),
  "The prelaunch reset still queries retired prospect observations or lost the live prospect-report guard."
);
const platformDataRepository = await readFile("packages/platform-data/repository.ts", "utf8");
assert(!platformDataRepository.includes("siteIntentMatchesBuildContent"), "Platform data still compares candidates to a legacy content-readiness projection.");
assert(!publication.includes("preview_only_reference_assets") && !publication.includes("asset.reference_only"), "Retired preview-only media publication logic remains.");
const mediaAuthoringPolicy = await readFile("docs/media-authoring-policy.md", "utf8");
assert(mediaAuthoringPolicy.includes("`source_website`") && mediaAuthoringPolicy.includes("There is no owner attestation"), "The canonical source-site media policy is not recorded.");
assert(workflow.includes("createImageBytes") && workflow.includes("inspect_assets"), "Image generation or selective managed-media inspection is missing from authoring.");
assert(!publication.includes("checkout") && !publication.includes("verificationLevel"), "Claims-era publication gates remain.");
const siteContracts = await readFile("packages/site-contracts/index.ts", "utf8");
assert(siteContracts.includes('"source_website", "owner_upload", "platform_generated"'), "Typed media origin is missing from canonical contracts.");
assert(!siteContracts.includes('"external_batch"') && !siteContracts.includes("publishAfterSuccess"), "Retired batch or auto-publication run contracts remain.");
const platformSiteSchema = siteContracts.match(/export const platformSiteRecordSchema = z\.object\(\{([\s\S]*?)\n\}\)\.strict\(\);/)?.[1] ?? "";
const publicBuildInputSchema = siteContracts.match(/export const sitePublicBuildInputSchema = z\.object\(\{([\s\S]*?)\n\}\)\.strict\(\);/)?.[1] ?? "";
assert(platformSiteSchema.includes("sourceUrl: publicUrl.optional()"), "Canonical site records made URL input mandatory.");
assert(publicBuildInputSchema.includes("sourceSnapshotIds: z.array(identifier)") && !publicBuildInputSchema.includes("sourceSnapshotIds: z.array(identifier).min("), "Canonical public build input requires a source snapshot.");
const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { scripts?: Record<string, string> };
for (const suite of ["architecture", "database", "authoring", "runtime", "account-setup-domain", "acquisition"]) {
  assert(packageJson.scripts?.[`verify:${suite}`], `Consolidated ${suite} verification suite is missing.`);
}
for (const command of Object.values(packageJson.scripts ?? {})) {
  for (const match of command.matchAll(/(?:^|\s)([A-Za-z0-9_./-]+\.(?:ts|tsx|js|mjs|sh))(?:\s|$)/g)) {
    await access(match[1]);
  }
}
console.log(JSON.stringify({ ok: true, filesChecked: sourceFiles.length, canonicalMigration: true }));

async function walk(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}
async function walkText(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walkText(path);
    if (entry.name === "package-lock.json") return [];
    return /\.(?:ts|tsx|js|mjs|json|jsonc|sql|md|sh|txt|yml|yaml)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}
async function assertMissing(path: string) {
  try { await access(path); } catch { return; }
  assert.fail(`Retired path still exists: ${path}`);
}

function versionedLodestaDeclarations(path: string, source: string) {
  const scriptKind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind);
  const names: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isTypeAliasDeclaration(node)
      || ts.isInterfaceDeclaration(node)
      || ts.isClassDeclaration(node)
      || ts.isEnumDeclaration(node)
      || ts.isFunctionDeclaration(node)
    ) {
      if (node.name && /V\d+$/.test(node.name.text)) names.push(node.name.text);
    } else if (ts.isVariableStatement(node)) {
      const exported = node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const name = declaration.name.text;
        if (/V\d+Schema$/.test(name) || (exported && /V\d+$/.test(name))) names.push(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names.sort();
}

function numberedInternalLabels(source: string) {
  const labels = [
    ...source.matchAll(/(?:[a-z][a-z0-9]*(?:[-_./:][a-z0-9]+)*)[-_./:]v\d+(?:\.\d+)?|\bV\d+(?:\.\d+)?\b/gi)
  ].map((match) => match[0]);
  return [...new Set(labels)].sort();
}

function allowedBoundaryLabel(path: string, label: string) {
  if (["api.openai.com/v1", "openrouter.ai/api/v1"].includes(label)) return true;
  if (label.includes("site-runtime-v")) return true;
  const boundaryFiles = [
    /^\.env\.example$/,
    /^\.github\//,
    /^docs\/generated-site-successor-experiment-plan\.md$/,
    /^docs\/generated-site-visual-process-experiment-plan\.md$/,
    /^docs\/canonical-v4-consolidation-plan\.md$/,
    /^docs\/generated-site-authoring-status\.md$/,
    /^docs\/site-authoring-experiment-retrospective-\d{4}-\d{2}-\d{2}\.md$/,
    /^docs\/decisions\//,
    /^docs\/local-business-cro-research-playbook\.md$/,
    /^docs\/prospect-research\.md$/,
    /^docs\/website-assessment-calibration\.md$/,
    /^supabase\/migrations\//,
    /^supabase\/migrations\/202607270001_website_health_report_v2\.sql$/,
    /^workers\/(?:site-sandbox|artifact-broker|recovery-watchdog)\//,
    /^packages\/trusted-runtime\//,
    /^packages\/site-evidence\//,
    /^packages\/site-artifacts\/(?:blob-store|maintenance-store)\.ts$/,
    /^packages\/platform-operations\/preview-access\.ts$/,
    /^packages\/site-sandbox\/(?:client|runtime-config)\.ts$/,
    /^packages\/site-agent\/openrouter-anthropic-messages\.ts$/,
    /^packages\/site-verification\/browser-gate\.ts$/,
    /^packages\/business-data\/public-projection\.ts$/,
    /^packages\/website-assessment\/browser-evidence\.ts$/,
    /^app\/api\/site-agent\/sessions\/\[sessionId\]\/preview\//,
    /^app\/api\/operator\/runtime\/route\.ts$/,
    /^scripts\/(?:build-first-five-prospect-reports|discover-open-prospects|enrich-prospect-ownership|enrich-prospect-websites|import-pest-control-license-rosters|import-prospects|rank-prospects|select-prospect-sample|verify-google-business-listings|verify-prospect-research)\.ts$/,
    /^scripts\/(?:canonical-authoring-evidence|configure-r2-lifecycle|deploy-site-sandbox-dev|promote-site-runtime|r2-lifecycle-policy|site-sandbox-manifest|verify-analytics|verify-artifact-storage-boundaries|verify-canonical-authoring-evidence|verify-deployment-config|verify-development-sandbox|verify-r2-lifecycle|verify-release-evidence|verify-site-authoring-platform|verify-site-authoring-render-browser|verify-supabase|verify-trusted-font-coverage|verify-trusted-runtime|verify-website-assessments|view-canonical-authoring-evidence)\.ts$/,
    /^scripts\/support\/synthetic-site-input\.ts$/,
    /^lib\/(?:analytics|analytics-ingestion|domains|privacy|rate-limit|inquiries)\.ts$/,
    /^scripts\/verify-site-authoring-architecture\.ts$/
  ];
  if (boundaryFiles.some((pattern) => pattern.test(path))) return true;
  if (path === "packages/site-platform/workflow.ts") {
    return label === "node:v8" || label === "V1" || label.startsWith("site-runtime-v");
  }
  if (path === "packages/site-agent/font-library.ts") return label === "v1";
  if (path === "packages/site-agent/manager.ts") return label.endsWith("/v1");
  if (path === "scripts/verify-site-sandbox-operations.ts") return label === "v1";
  return false;
}
