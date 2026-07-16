import assert from "node:assert/strict";
import { assertVisualSectionsForVersionV3 } from "../lib/site-version-v3";
import { validateSiteCopyForPlan } from "../lib/generation-contracts";
import { buildCanonicalFixture, loadCanonicalFixtureDefinitions } from "./canonical-generation-fixtures";

const definitions = await loadCanonicalFixtureDefinitions();
const results = [];

for (const definition of definitions) {
  const fixture = await buildCanonicalFixture(definition);
  assert.equal(fixture.plan.designSystem, definition.expectedDesignSystem, `${definition.id} selected the wrong design system.`);
  const copyValidation = validateSiteCopyForPlan(fixture.plan, fixture.copy);
  assert.equal(copyValidation.ok, true, copyValidation.issues.join("\n"));
  assertVisualSectionsForVersionV3(fixture.version);
  assert.equal(fixture.version.pageComposition.pages.length, 1 + Math.min(3, fixture.business.services.length));
  results.push({
    id: definition.id,
    designSystem: fixture.plan.designSystem,
    pages: fixture.version.pageComposition.pages.length,
    sections: fixture.version.pageComposition.pages.reduce((sum, candidate) => sum + candidate.sections.length, 0),
    evidenceAccepted: fixture.evidence.yield.accepted,
    evidenceRejected: fixture.evidence.yield.rejected,
    trace: { plans: 1, copies: 1, compiles: 1, gates: 0, judges: 0 }
  });
}

console.log(JSON.stringify({ ok: true, fixtures: results }, null, 2));
