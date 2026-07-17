import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertVisualSectionsForVersionV3 } from "../lib/site-version-v3";
import { validateSiteCopyForPlan } from "../lib/generation-contracts";
import {
  bakeoffInputArtifact,
  buildCanonicalFixture,
  loadCanonicalFixtureDefinitions,
  templatedBaselineArtifact
} from "./canonical-generation-fixtures";

const definitions = await loadCanonicalFixtureDefinitions();
const frozenManifest = JSON.parse(
  await readFile(path.join(process.cwd(), "fixtures/generation-pipeline/bakeoff-v1/manifest.json"), "utf8")
) as { schemaVersion?: string; fixtures?: Array<{ id?: string }> };
assert.equal(frozenManifest.schemaVersion, "generation-bakeoff-manifest-v1");
assert.deepEqual(frozenManifest.fixtures?.map((fixture) => fixture.id), definitions.map((definition) => definition.id));
const results = [];

for (const definition of definitions) {
  const fixture = await buildCanonicalFixture(definition);
  assert.equal(fixture.plan.designSystem, definition.expectedDesignSystem, `${definition.id} selected the wrong design system.`);
  const copyValidation = validateSiteCopyForPlan(fixture.plan, fixture.copy);
  assert.equal(copyValidation.ok, true, copyValidation.issues.join("\n"));
  assertVisualSectionsForVersionV3(fixture.version);
  assert.equal(
    new Set(fixture.business.services.map((service) => service.toLocaleLowerCase("en-US"))).size,
    fixture.business.services.length,
    `${definition.id} must not render duplicate catalog-equivalent offerings.`
  );
  assert.equal(fixture.version.pageComposition.pages.length, 1 + Math.min(3, fixture.business.services.length));
  const frozenRoot = path.join(process.cwd(), "fixtures/generation-pipeline/bakeoff-v1", definition.id);
  const frozenInput = JSON.parse(await readFile(path.join(frozenRoot, "input.json"), "utf8")) as unknown;
  const frozenBaseline = JSON.parse(await readFile(path.join(frozenRoot, "templated-baseline.json"), "utf8")) as unknown;
  assert.deepEqual(frozenInput, jsonValue(bakeoffInputArtifact(fixture)), `${definition.id} bakeoff input drifted; explicitly refreeze it.`);
  assert.deepEqual(frozenBaseline, jsonValue(templatedBaselineArtifact(fixture)), `${definition.id} templated baseline drifted; explicitly refreeze it.`);
  assert.equal(fixture.sourceSnapshots.some((source) => source.sourceType === "website"), true);
  assert.equal(fixture.observations.some((observation) => observation.status === "selected_for_preview"), true);
  for (const asset of fixture.snapshot.assets) {
    assert.equal(asset.revision.contentHash.length, 64);
    assert.equal(asset.revision.bytes > 0, true);
    assert.equal(asset.revision.storagePath.startsWith("public/fixture-assets/"), true);
  }
  results.push({
    id: definition.id,
    designSystem: fixture.plan.designSystem,
    pages: fixture.version.pageComposition.pages.length,
    sections: fixture.version.pageComposition.pages.reduce((sum, candidate) => sum + candidate.sections.length, 0),
    evidenceAccepted: fixture.evidence.yield.accepted,
    evidenceRejected: fixture.evidence.yield.rejected,
      trace: { plans: 1, copies: 1, compiles: 1, gates: 0, judges: 0 },
      inputHash: fixture.snapshot.inputHash
    });
}

console.log(JSON.stringify({ ok: true, fixtures: results }, null, 2));

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
