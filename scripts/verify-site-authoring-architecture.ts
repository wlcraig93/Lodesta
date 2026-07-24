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
  "lib/claim-verification-challenge.ts", "lib/stripe-webhook.ts", "scripts/run-site-experiment.ts"
]) await assertMissing(path);

for (const { path, source } of sources) {
  const versioned = versionedLodestaDeclarations(path, source);
  assert.deepEqual(versioned, [], `${path} declares version-suffixed Lodesta identifiers: ${versioned.join(", ")}`);
}
for (const { path, source } of labelSources) {
  const unexpected = numberedInternalLabels(source).filter((label) => !allowedBoundaryLabel(path, label));
  assert.deepEqual(unexpected, [], `${path} contains numbered internal labels: ${unexpected.join(", ")}`);
}
const unexpectedVersionedFiles = labelFiles.filter((path) => /(?:^|[/_.-])v\d+(?:\.\d+)?(?:[/_.-]|$)/i.test(path) && path !== "packages/trusted-runtime/site-runtime-v1.js");
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
const accessSource = await readFile("lib/page-access.ts", "utf8");
assert(accessSource.includes("site.ownerUserId === userId") && !accessSource.includes("ownerEmail"), "Site access is not exact user-ID ownership.");
const publication = await readFile("packages/site-platform/publication-readiness.ts", "utf8");
assert(!publication.includes("preview_only_reference_assets") && !publication.includes("asset.reference_only"), "Retired preview-only media publication logic remains.");
const externalAuthoringPlan = await readFile("docs/external-codex-authoring.md", "utf8");
assert(externalAuthoringPlan.includes("typed `source_website` origin") && externalAuthoringPlan.includes("does not create a separate approval or publication gate"), "The canonical source-site media policy is not recorded.");
assert(workflow.includes("createImageBytes") && workflow.includes("createMediaContactSheet"), "Image generation or initial media context is missing from authoring.");
assert(!publication.includes("checkout") && !publication.includes("verificationLevel"), "Claims-era publication gates remain.");
const siteContracts = await readFile("packages/site-contracts/index.ts", "utf8");
assert(siteContracts.includes('"source_website", "owner_upload", "platform_generated"'), "Typed media origin is missing from canonical contracts.");
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
  const boundaryFiles = [
    /^\.env\.example$/,
    /^\.github\//,
    /^docs\/local-business-cro-research-playbook\.md$/,
    /^workers\/(?:site-sandbox|artifact-broker|recovery-watchdog)\//,
    /^packages\/trusted-runtime\//,
    /^packages\/site-artifacts\/(?:blob-store|maintenance-store)\.ts$/,
    /^packages\/platform-operations\/preview-access\.ts$/,
    /^packages\/site-sandbox\/client\.ts$/,
    /^packages\/site-verification\/browser-gate\.ts$/,
    /^packages\/business-data\/public-projection\.ts$/,
    /^packages\/website-assessment\/browser-evidence\.ts$/,
    /^app\/api\/site-agent\/sessions\/\[sessionId\]\/preview\//,
    /^app\/api\/operator\/runtime\/route\.ts$/,
    /^scripts\/(?:configure-r2-lifecycle|promote-site-runtime|r2-lifecycle-policy|verify-analytics|verify-artifact-storage-boundaries|verify-external-authoring|verify-r2-lifecycle|verify-site-authoring-platform|verify-site-authoring-render-browser|verify-trusted-runtime|verify-website-assessments)\.ts$/,
    /^scripts\/support\/synthetic-site-input\.ts$/,
    /^lib\/(?:analytics|analytics-ingestion|domains|privacy|rate-limit|inquiries)\.ts$/,
    /^scripts\/verify-site-authoring-architecture\.ts$/
  ];
  if (boundaryFiles.some((pattern) => pattern.test(path))) return true;
  if (path === "lib/model-catalog.ts") {
    return ["api.openai.com/v1", "openrouter.ai/api/v1"].includes(label);
  }
  if (path === "packages/site-platform/workflow.ts") return ["node:v8", "site-runtime-v1", "V1"].includes(label);
  if (path === "packages/site-agent/manager.ts") return label.endsWith("/v1");
  return false;
}
