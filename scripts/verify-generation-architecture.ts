import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { activeSectionTemplateOrderV3 } from "../lib/generated-site-v3-section-templates";

const root = process.cwd();
const canonicalFiles = [
  "lib/source-text-blocks.ts",
  "lib/generation-evidence-manifest.ts",
  "lib/generation-contracts.ts",
  "lib/business-fact-normalization.ts",
  "lib/vertical-packs.ts",
  "lib/site-copy.ts",
  "lib/site-compiler.ts",
  "lib/generation-objective-gate.ts",
  "lib/generation-judge.ts",
  "lib/generation-pipeline.ts",
  "lib/control-plane-contracts.ts",
  "lib/control-plane.ts",
  "lib/control-plane-service.ts",
  "lib/generation-entry-contracts.ts",
  "lib/intake-generation-snapshot.ts",
  "lib/site-render-envelope.ts",
  "lib/public-site-version.ts"
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
const snapshotOnlyGenerationModules = [
  "lib/generation-pipeline.ts",
  "lib/vertical-packs.ts",
  "lib/site-copy.ts",
  "lib/site-compiler.ts",
  "lib/generation-objective-gate.ts",
  "lib/generation-judge.ts",
  "lib/site-render-envelope.ts",
  "lib/site-renderer.tsx",
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
  "fact-verification",
  "generation-evidence-manifest-v1",
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
  if (/(?:from\s+|import\s*\()\s*["'][^"']*test-support\//.test(source)) {
    assert.equal(
      relativeFile,
      "lib/sample-data.ts",
      `${relativeFile} imports test support; only the local sample store may do so outside scripts.`
    );
  }
  if (!relativeFile.startsWith("lib/test-support/")) {
    for (const forbiddenFallback of ["modelFallbackPolicy", "deterministicFixtureDependencies", "createFixtureSiteCopy"]) {
      assert.equal(
        source.includes(forbiddenFallback),
        false,
        `${relativeFile} exposes removed production generation fallback ${forbiddenFallback}.`
      );
    }
    if (source.includes("createTestSiteCopy")) {
      assert.equal(relativeFile, "lib/sample-data.ts", `${relativeFile} uses deterministic test copy outside the local sample store.`);
    }
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
for (const relativeFile of snapshotOnlyGenerationModules) {
  const source = await readFile(path.join(root, relativeFile), "utf8");
  const imports = importedModuleNames(source);
  for (const mutableAuthorityModule of ["repository", "store", "supabase"]) {
    assert.equal(
      imports.includes(mutableAuthorityModule),
      false,
      `${relativeFile} imports mutable authority ${mutableAuthorityModule}; canonical generation consumes immutable snapshots only.`
    );
  }
}

const contracts = await readFile(path.join(root, "lib/generation-contracts.ts"), "utf8");
assert.match(contracts, /"precision_shop_editorial"\s*\|\s*"trusted_local_service"/);
assert.equal((contracts.match(/export type ShippingDesignSystemId/g) ?? []).length, 1);
assert.match(contracts, /verticalPack:\s*\{\s*id: string;\s*version: string;/, "Generation plans must retain the selected vertical-pack identity.");

const systems = await readFile(path.join(root, "lib/vertical-packs.ts"), "utf8");
assert.match(systems, /"trusted_local_service"/);
assert.match(systems, /"precision_shop_editorial"/);
assert.match(systems, /verticalPack:\s*\{ id: pack\.id, version: pack\.version \}/, "The planner must bind the selected vertical-pack identity into every plan.");

assert.deepEqual([...activeSectionTemplateOrderV3].sort(), [
  "auto_body_service_index",
  "contact_split",
  "faq_list",
  "hero_split",
  "hero_statement",
  "location_showcase",
  "numbered_steps",
  "quote_wall",
  "service_area_showcase",
  "side_intro_rows"
], "The public renderer catalog must expose only the two-system canonical templates.");

const copySource = await readFile(path.join(root, "lib/site-copy.ts"), "utf8");
assert.equal((copySource.match(/operation: "whole_site_copy"/g) ?? []).length, 1, "Canonical copy must expose one whole-site model operation.");
assert.equal((copySource.match(/for \(const attempt of \[1, 2\]/g) ?? []).length, 1, "Canonical copy permits exactly one schema/transient retry.");
assert.match(copySource, /allowedEvidence:\s*\[\]/, "Trust-sensitive proof must not enter model-authored copy.");
assert.equal(copySource.includes("createTestSiteCopy"), false, "Production site copy must not contain deterministic test generation.");
const testCopySource = await readFile(path.join(root, "lib/test-support/site-copy.ts"), "utf8");
assert.match(testCopySource, /export function createTestSiteCopy/, "Deterministic copy must remain explicit test support.");

const judgeSource = await readFile(path.join(root, "lib/generation-judge.ts"), "utf8");
for (const [relativeFile, source] of [["lib/site-copy.ts", copySource], ["lib/generation-judge.ts", judgeSource]] as const) {
  assert.equal(/auto[- ]body/i.test(source), false, `${relativeFile} embeds auto-body domain language outside the selected vertical pack.`);
  assert.match(source, /verticalPackFor\(/, `${relativeFile} must obtain domain context from the selected vertical pack.`);
  assert.match(source, /businessCategory:\s*pack\.businessCategory/, `${relativeFile} must pass pack-owned business context to the model.`);
}

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
  "generation_evidence_manifest",
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
for (const legacyAuthority of ["profile_json", "bundle_json", "business_profiles", "site_assets", "fact_candidates", "business_services"]) {
  assert.equal(schemaSource.includes(legacyAuthority), false, `Database schema still exposes legacy authority ${legacyAuthority}.`);
}
for (const retainedReference of [
  /source_snapshot_id text not null references source_snapshots\(id\) on delete restrict/,
  /asset_revision_id text not null references asset_revisions\(id\) on delete restrict/,
  /input_snapshot_id text not null references generation_input_snapshots\(id\) on delete restrict/,
  /form_definition_id text not null references form_definitions\(id\) on delete restrict/
]) {
  assert.match(schemaSource, retainedReference, `Strict retained input is missing an on-delete-restrict reference: ${retainedReference}.`);
}
assert.match(schemaSource, /state_hash text not null/, "Canonical business revisions must bind to an immutable content hash.");
assert.match(schemaSource, /intent_hash text not null/, "Site-intent revisions must bind to an immutable content hash.");
const cutoverMigrationSource = await readFile(path.join(root, "supabase/migrations/202607160002_canonical_control_plane.sql"), "utf8");
assert.match(cutoverMigrationSource, /add column state_hash text not null/, "The hard cutover must install business-state content hashes.");
assert.match(cutoverMigrationSource, /intent_hash text not null/, "The hard cutover must install site-intent content hashes.");
const supabaseRepositorySource = await readFile(path.join(root, "lib/supabase/repository.ts"), "utf8");
assert.match(supabaseRepositorySource, /currentBusiness\.state_hash !== stateHash/, "Durable business writes must reject same-revision content changes.");
assert.match(supabaseRepositorySource, /currentIntent\.intent_hash !== intentHash/, "Durable intent writes must reject same-revision content changes.");

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
assert.equal(rendererSource.includes('value="form_contact"'), false, "Public renderer must not hard-code a form identity.");
assert.match(rendererSource, /value=\{formDefinition\.id\}/, "Public renderer must use the immutable form identity.");
assert.match(rendererSource, /formDefinition\.fields\.map/, "Public renderer must use the immutable form field list.");

const formSubmitSource = await readFile(path.join(root, "app/api/forms/submit/route.ts"), "utf8");
assert.match(formSubmitSource, /getPublishedFormDefinition\(siteId, formId\)/, "Public form submissions must authorize against a retained published version.");
const publicSiteSource = await readFile(path.join(root, "app/sites/[slug]/[[...path]]/page.tsx"), "utf8");
assert.match(publicSiteSource, /loadPublicSiteVersion/, "Public rendering must resolve an eligible immutable published version.");
const renderEnvelopeSource = await readFile(path.join(root, "lib/site-render-envelope.ts"), "utf8");
assert.equal(renderEnvelopeSource.includes("envelope.locations = input.shell.locations"), false, "Retained versions must not render mutable shell locations.");
assert.match(renderEnvelopeSource, /input\.snapshot\.business\.googlePlaceId/, "Retained location proof must derive from the immutable generation snapshot.");
const controlPlaneServiceSource = await readFile(path.join(root, "lib/control-plane-service.ts"), "utf8");
assert.match(controlPlaneServiceSource, /coalesceKey: `control_plane:\$\{request\.siteId\}`/, "Structural rebuilds must coalesce by managed site.");
assert.match(controlPlaneServiceSource, /snapshot\.eligibilityMode !== "public"/, "Protected-preview deterministic recompiles must remain drafts.");
const scrapedMediaSource = await readFile(path.join(root, "lib/scraped-media.ts"), "utf8");
assert.equal(scrapedMediaSource.includes("forceLocal: true"), false, "Scraped media must use durable configured storage, not process-local storage.");
assert.match(scrapedMediaSource, /publicUrl:\s*false/, "Scraped media must be uploaded without a public storage URL.");
assert.match(scrapedMediaSource, /storagePath:\s*stored\.storagePath/, "Scraped media must retain its durable storage identity.");
assert.match(scrapedMediaSource, /mimeType:\s*downloaded\.mimeType/, "Scraped media must retain the downloaded MIME type.");
const intakeSnapshotSource = await readFile(path.join(root, "lib/intake-generation-snapshot.ts"), "utf8");
assert.equal(intakeSnapshotSource.includes("Math.max(1, asset.url?.length"), false, "Asset revisions must never synthesize byte counts from URLs.");
assert.equal(intakeSnapshotSource.includes("external/${hash(asset.url"), false, "Asset revisions must never synthesize storage paths from remote URLs.");
assert.match(intakeSnapshotSource, /sourceType:\s*"google_places"/, "Intake must retain Google Places as an independent source snapshot.");
assert.match(intakeSnapshotSource, /status = canonicalJson\(candidate\.normalizedValue\) === selectedValue \? "superseded" : "conflict"/, "Non-selected scalar observations must preserve source conflicts.");
const intakeRouteSource = await readFile(path.join(root, "app/api/intake/route.ts"), "utf8");
assert.match(intakeRouteSource, /freshIntakeRequestSchema\.safeParse\(body\)/, "Fresh intake must use the canonical URL request contract.");
const generationEntryContractsSource = await readFile(path.join(root, "lib/generation-entry-contracts.ts"), "utf8");
assert.match(generationEntryContractsSource, /url:\s*z\.string\(\)\.trim\(\)\.min\(1\),/, "Fresh intake must require a URL.");
assert.equal(intakeRouteSource.includes("Provide a URL or prompt"), false, "Prompt-only intake must remain deleted.");
const regenerationRouteSource = await readFile(path.join(root, "app/api/sites/regenerate/route.ts"), "utf8");
assert.equal(regenerationRouteSource.includes("sourceUrl"), false, "Snapshot regeneration must not depend on a retained source URL.");
assert.match(regenerationRouteSource, /inputSnapshotId:\s*controlPlane\.latestSnapshot\.id/, "Snapshot regeneration must queue the exact immutable input.");
const candidateServiceSource = await readFile(path.join(root, "lib/site-candidate-service.ts"), "utf8");
assert.match(candidateServiceSource, /mode:\s*"fresh"/, "Generation must expose an explicit fresh URL mode.");
assert.match(candidateServiceSource, /mode:\s*"snapshot"/, "Generation must expose an explicit immutable-snapshot mode.");
assert.equal(candidateServiceSource.includes("modelFallbackPolicy"), false, "Production generation must fail loudly instead of selecting deterministic fallback.");
const jobsSource = await readFile(path.join(root, "lib/jobs.ts"), "utf8");
assert.equal(jobsSource.includes("modelFallbackPolicy"), false, "Jobs must not carry a production fallback policy.");
const assetRouteSource = await readFile(path.join(root, "app/api/assets/[siteId]/[file]/route.ts"), "utf8");
assert.match(assetRouteSource, /readStoredAsset/, "The authenticated asset route must read from configured durable storage.");
assert.equal(assetRouteSource.includes("readLocalAsset"), false, "The authenticated asset route must not bypass configured durable storage.");

const packageSource = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
assert.equal(typeof packageSource.scripts?.["freeze:generation-inputs"], "string", "Canonical inputs need an explicit freeze command.");
assert.equal(packageSource.scripts?.["freeze:generation-bakeoff"], undefined, "The obsolete baseline freeze command must remain deleted.");
const fixtureRoot = path.join(root, "fixtures/generation-pipeline/bakeoff-v1");
const fixtureFiles = await allFiles(fixtureRoot);
assert.equal(
  fixtureFiles.some((file) => path.basename(file) === "compiler-references.json"),
  true,
  "Canonical fixtures must retain one reviewable compiler reference file."
);
assert.equal(
  fixtureFiles.some((file) => path.basename(file) === "templated-baseline.json"),
  false,
  "Full compiled templated baselines must not be committed."
);
const browserVerifierSource = await readFile(path.join(root, "scripts/verify-canonical-render-browser.ts"), "utf8");
assert.match(browserVerifierSource, /"\.data",\s*"generation-review",\s*runId/, "Browser captures must use unique ignored run directories.");
assert.equal(browserVerifierSource.includes('".design", "generation-review"'), false, "Browser verification must not write tracked design artifacts.");
assert.equal(browserVerifierSource.includes("rm(artifactRoot"), false, "Browser verification must not delete a previous review run.");

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
  "app/api/business-profile/route.ts",
  "app/api/business-services/route.ts",
  "app/api/evidence/confirm/route.ts",
  "app/api/forms/settings/route.ts",
  "app/api/sites/update-section/route.ts",
  "app/api/site-candidates/[candidateId]/business-profile/route.ts",
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
  snapshotOnlyGenerationModules: snapshotOnlyGenerationModules.length,
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

async function allFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? allFiles(file) : [file];
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
