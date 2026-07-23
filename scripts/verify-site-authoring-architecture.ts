import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

const sourceFiles = (await Promise.all(["app", "components", "lib", "packages", "workers", "scripts"].map(walk))).flat();
const sources = await Promise.all(sourceFiles.map(async (path) => ({ path, source: await readFile(path, "utf8") })));
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
assert.deepEqual(versionedLodestaDeclarations("fixture.ts", `
  import { ListObjectsV2Command } from "@aws-sdk/client-s3";
  const sourceV4 = [];
  const sourceV6 = [];
  const targetV4 = [];
  const targetV6 = [];
`), [], "Imported SDK names and ordinary IPv4/IPv6 locals must not be treated as Lodesta contract declarations.");
assert.deepEqual(versionedLodestaDeclarations("fixture.ts", `
  type RetiredContractV2 = {};
  export const defaultAccessPolicyV1 = {};
  const retiredContractV3Schema = {};
`), ["RetiredContractV2", "defaultAccessPolicyV1", "retiredContractV3Schema"]);
for (const table of [
  "business_states_v3", "site_intents_v3", "form_definitions_v2", "site_versions_v4",
  "website_setups_v1", "site_redirects_v1", "jobs", "claims", "site_version_approvals_v1"
]) assert(!new RegExp(`create table ${table}\\b`).test(baseline), `Baseline declares retired table ${table}.`);

const workflow = await readFile("packages/site-platform/workflow.ts", "utf8");
assert(!workflow.includes("ExistingSourceCollisionError") && !workflow.includes("existingSourcePolicy"), "Source collision reuse remains in authoring.");
assert(!workflow.includes('mode?: "draft" | "experimental"'), "Experimental authoring mode remains.");
const accessSource = await readFile("lib/page-access.ts", "utf8");
assert(accessSource.includes("site.ownerUserId === userId") && !accessSource.includes("ownerEmail"), "Site access is not exact user-ID ownership.");
const publication = await readFile("packages/site-platform/publication-readiness.ts", "utf8");
assert(publication.includes('"asset_rights"') && publication.includes("platform_cleared") && publication.includes("owner_attested"), "Asset licensing was removed from the objective publication boundary.");
assert(!publication.includes("checkout") && !publication.includes("verificationLevel"), "Claims-era publication gates remain.");
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
