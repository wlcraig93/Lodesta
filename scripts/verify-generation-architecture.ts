import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { activeSectionTemplateOrderV3 } from "../lib/generated-site-v3-section-templates";

const root = process.cwd();
const canonicalFiles = [
  "lib/source-text-blocks.ts",
  "lib/evidence-ledger.ts",
  "lib/generation-contracts.ts",
  "lib/business-fact-normalization.ts",
  "lib/vertical-packs.ts",
  "lib/site-copy.ts",
  "lib/site-compiler.ts",
  "lib/generation-objective-gate.ts",
  "lib/generation-judge.ts",
  "lib/generation-pipeline.ts"
];
const productionRoots = ["app", "components", "lib", "workers"];
const runtimeGraph = [
  "lib/site-candidate-service.ts",
  "lib/generation-pipeline.ts",
  "lib/site-copy.ts",
  "lib/site-compiler.ts",
  "lib/generation-objective-gate.ts",
  "lib/generation-judge.ts",
  "lib/intake.ts",
  "lib/site-renderer-v3.tsx"
];
const legacyModules = [
  "ad-hoc-design-examples",
  "ai-editor",
  "auto-body-service-copy-v1",
  "brand-direction-v2",
  "brand-expression-v1",
  "brand-mark-generation-v2",
  "brand-wordmark-v2",
  "business-context-refresh-v2",
  "business-identity-service-v2",
  "claim-report-v2",
  "copy-phrase-policy-v1",
  "design-system-gate-review-v1",
  "design-system-planner-constraints-v1",
  "design-system-planner-manifest-v1",
  "deterministic-site-director-plan-v1",
  "evidence-ledger-v1",
  "generated-copy-v2",
  "generated-site-design-systems-v1",
  "generated-site-v3-art-direction-catalog",
  "generated-site-qa",
  "generated-site-readiness",
  "generated-site-v3-compiler",
  "generated-site-v3-pipeline",
  "generation-gate",
  "generation-cost",
  "optimization",
  "page-opportunities-v2",
  "performance-audit-v2",
  "policy-report-v2",
  "precompile-resolution-gate",
  "qa",
  "regulated-claims-policy-v2",
  "seo-local-landing-pages-v2",
  "site-director-plan-v1",
  "site-dossier-v1",
  "social-proof-v2",
  "strategy-planning-v2",
  "visual-qa"
];

const productionFiles = (await Promise.all(productionRoots.map((directory) => sourceFiles(path.join(root, directory))))).flat();
const productionSources = new Map(await Promise.all(productionFiles.map(async (file) => [file, await readFile(file, "utf8")] as const)));

for (const relativeFile of canonicalFiles) {
  assert.equal(await exists(path.join(root, relativeFile)), true, `Missing canonical generation file ${relativeFile}.`);
}

for (const [file, source] of productionSources) {
  const relativeFile = path.relative(root, file);
  for (const legacyModule of legacyModules) {
    assert.equal(
      importedModuleNames(source).includes(legacyModule),
      false,
      `${relativeFile} imports deleted generation module ${legacyModule}.`
    );
  }
  if (source.includes("runCanonicalGenerationPipeline")) {
    assert.equal(
      relativeFile === "lib/generation-pipeline.ts" || relativeFile === "lib/site-candidate-service.ts",
      true,
      `${relativeFile} bypasses the canonical site-candidate generation entrypoint.`
    );
  }
}

const verticalBranch = /(?:business(?:Profile)?\.vertical|\bvertical)\s*(?:===|!==)|switch\s*\([^)]*\bvertical\b/;
const allowedVerticalBranchFiles = new Set(["lib/standard.ts", "lib/vertical-classification.ts", "lib/vertical-packs.ts"]);
for (const [file, source] of productionSources) {
  const relativeFile = path.relative(root, file);
  if (verticalBranch.test(source)) {
    assert.equal(
      allowedVerticalBranchFiles.has(relativeFile),
      true,
      `${relativeFile} branches on a vertical outside the canonical registry or vertical pack.`
    );
  }
}
for (const relativeFile of runtimeGraph) {
  const source = await readFile(path.join(root, relativeFile), "utf8");
  assert.equal(verticalBranch.test(source), false, `${relativeFile} branches on a vertical inside the canonical runtime graph.`);
}

const contracts = await readFile(path.join(root, "lib/generation-contracts.ts"), "utf8");
assert.match(contracts, /"precision_shop_editorial"\s*\|\s*"trusted_local_service"/);
assert.equal((contracts.match(/export type ShippingDesignSystemId/g) ?? []).length, 1);

const systems = await readFile(path.join(root, "lib/vertical-packs.ts"), "utf8");
assert.match(systems, /"trusted_local_service"/);
assert.match(systems, /"precision_shop_editorial"/);

assert.deepEqual([...activeSectionTemplateOrderV3].sort(), [
  "contact_split",
  "faq_list",
  "hero_split",
  "hero_statement",
  "location_showcase",
  "numbered_steps",
  "quote_wall",
  "service_area_showcase",
  "service_index",
  "side_intro_rows"
], "The public renderer catalog must expose only the two-system canonical templates.");

const copySource = await readFile(path.join(root, "lib/site-copy.ts"), "utf8");
assert.equal((copySource.match(/operation: "whole_site_copy"/g) ?? []).length, 1, "Canonical copy must expose one whole-site model operation.");
assert.equal((copySource.match(/for \(const attempt of \[1, 2\]/g) ?? []).length, 1, "Canonical copy permits exactly one schema/transient retry.");

const understandingSource = await readFile(path.join(root, "lib/business-understanding-v2.ts"), "utf8");
assert.equal(
  /format:\s*["']uri["']/.test(understandingSource),
  false,
  "OpenAI strict response schemas must not use the unsupported uri format; validate URLs locally after parsing."
);

const assetAnalysisSource = await readFile(path.join(root, "lib/asset-analysis-v1.ts"), "utf8");
assert.equal((assetAnalysisSource.match(/for \(const attempt of \[1, 2\]/g) ?? []).length, 1, "Capped asset vision permits exactly one response retry.");
assert.match(assetAnalysisSource, /openAiResponseIncompleteReason\(payload\)/, "Asset vision must reject incomplete structured responses before parsing.");
assert.equal(assetAnalysisSource.includes("if (input.strict) throw outcome.error;"), false, "One failed website-reference asset must not abort canonical generation.");

const pipelineSource = await readFile(path.join(root, "lib/generation-pipeline.ts"), "utf8");
assert.equal((pipelineSource.match(/for \(const attempt of \[0, 1\]/g) ?? []).length, 1, "Canonical generation permits exactly one regeneration.");
assert.match(pipelineSource, /validateGenerationPipelineTrace\(trace\)/);

const modelsSource = await readFile(path.join(root, "lib/models.ts"), "utf8");
const canonicalArtifactTypes = [
  "evidence_ledger",
  "generation_plan",
  "site_copy",
  "generation_review",
  "generation_failure",
  "operator_decision"
];
for (const artifactType of canonicalArtifactTypes) {
  assert.match(modelsSource, new RegExp(`\\|?\\s*"${artifactType}"`), `Missing canonical artifact type ${artifactType}.`);
}
for (const legacyArtifactType of ["copy_artifact", "business_context_report", "design_system", "v3_review_packet"]) {
  assert.equal(modelsSource.includes(`"${legacyArtifactType}"`), false, `Models still expose legacy artifact type ${legacyArtifactType}.`);
}

const schemaSource = await readFile(path.join(root, "supabase/schema.sql"), "utf8");
for (const artifactType of canonicalArtifactTypes) {
  assert.match(schemaSource, new RegExp(`'${artifactType}'`), `Database schema is missing canonical artifact type ${artifactType}.`);
}
for (const legacyArtifactColumn of ["producer_id", "vertical_playbook_version", "section_contract_version", "site_design_system_version"]) {
  assert.equal(schemaSource.includes(legacyArtifactColumn), false, `Database schema still exposes legacy artifact column ${legacyArtifactColumn}.`);
}
assert.equal(schemaSource.includes("optimization_findings"), false, "Database schema still exposes legacy optimization findings.");

const stylesheet = await readFile(path.join(root, "app/globals.css"), "utf8");
const retiredStyleSelectors = [
  /data-(?:eyebrow-treatment|card-chrome|figure-treatment|heading-case|badge-style|fact-highlight|header-surface|cta-band-tone)=/,
  /data-font-pairing="(?:editorial_serif_clean_sans|condensed_service_sans|warm_editorial_sans|friendly_rounded|magazine_grotesk|quiet_serif)"/,
  /data-button-system="(?:high_contrast_primary|rounded_primary)"/,
  /data-art-recipe="canonical_editorial"/
];
for (const retiredStyleSelector of retiredStyleSelectors) {
  assert.equal(retiredStyleSelector.test(stylesheet), false, `Public CSS contains retired design-selection selector ${retiredStyleSelector}.`);
}
const rendererSource = await readFile(path.join(root, "lib/site-renderer-v3.tsx"), "utf8");
assert.equal(rendererSource.includes("site-location-showcase-map-fallback-v3"), false, "Location link-only mode must collapse to a complete visit card, not a fake map placeholder.");
assert.equal(stylesheet.includes("site-location-showcase-map-fallback-v3"), false, "Fake location-map fallback styles must remain deleted.");

const strict = process.argv.includes("--cutover");
const legacyFiles = legacyModules.map((moduleName) => `lib/${moduleName}.ts`);
legacyFiles.push(
  "app/api/action-list/apply/route.ts",
  "app/api/action-list/apply-all/route.ts",
  "app/api/action-list/dismiss/route.ts",
  "app/api/ai/edit/route.ts",
  "app/api/audits/run/route.ts",
  "app/api/generated-qa/run/route.ts",
  "app/api/qa/run/route.ts",
  "app/api/sites/design/route.ts",
  "components/RunGeneratedQaForm.tsx"
);
const presentLegacyFiles = [];
for (const file of legacyFiles) {
  if (await exists(path.join(root, file))) presentLegacyFiles.push(file);
}
if (strict) {
  assert.deepEqual(presentLegacyFiles, [], `Cutover still contains legacy generation files: ${presentLegacyFiles.join(", ")}`);
}

console.log(JSON.stringify({
  ok: true,
  mode: strict ? "cutover" : "walking_skeleton",
  scannedProductionFiles: productionFiles.length,
  runtimeGraphFiles: runtimeGraph.length,
  canonicalFiles: canonicalFiles.length,
  shippingDesignSystems: 2,
  presentLegacyFiles
}, null, 2));

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [file] : [];
  }));
  return nested.flat();
}

function importedModuleNames(source: string): string[] {
  const names: string[] = [];
  const imports = /(?:from\s+|import\s*\(|require\s*\()\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(imports)) {
    names.push(path.basename(match[1]).replace(/\.(?:ts|tsx|js|mjs)$/, ""));
  }
  return names;
}

async function exists(file: string) {
  return stat(file).then(() => true, () => false);
}
