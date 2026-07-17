import assert from "node:assert/strict";
import { availableJudgeActions, generationJudgeContext, parseGenerationJudgeResult } from "../lib/generation-judge";
import { buildCanonicalFixture, loadCanonicalFixtureDefinitions } from "./canonical-generation-fixtures";

const definitions = await loadCanonicalFixtureDefinitions();
const mediaFixture = await buildCanonicalFixture(definitions[0]);
const noMediaFixture = await buildCanonicalFixture(definitions[3]);

assert.deepEqual(
  availableJudgeActions(mediaFixture.plan, mediaFixture.assets),
  ["copy", "alternate_system", "operator_review"]
);
assert.deepEqual(
  availableJudgeActions(noMediaFixture.plan, noMediaFixture.assets),
  ["copy", "operator_review"]
);
assert.deepEqual(
  generationJudgeContext({
    snapshot: {
      ...mediaFixture.snapshot,
      business: {
        ...mediaFixture.snapshot.business,
        offerings: ["Collision Repair", "Free Repair Estimates", "Insurance Repair Assistance"].map((customName, index) => ({
          id: `judge_offering_${index}`,
          businessId: mediaFixture.snapshot.businessId,
          customName,
          status: "confirmed" as const,
          visibility: "public" as const,
          pageMode: "shared" as const,
          featured: false,
          evidenceIds: [],
          createdAt: mediaFixture.snapshot.createdAt,
          updatedAt: mediaFixture.snapshot.createdAt
        }))
      }
    },
    plan: mediaFixture.plan,
    packet: { availableActions: ["copy", "operator_review"], images: [], textManifest: [] }
  }).business.services,
  ["Collision Repair"],
  "The judge must not request confirmation-gated facts omitted from public copy."
);

assert.deepEqual(
  parseGenerationJudgeResult({ verdict: "ship", action: "none", summary: "Ready to ship.", findings: [] }, ["copy", "operator_review"]),
  { verdict: "ship", action: "none", summary: "Ready to ship.", findings: [] }
);
assert.deepEqual(
  parseGenerationJudgeResult({ verdict: "revise", action: "copy", summary: "Copy needs one revision.", findings: [] }, ["copy", "operator_review"]),
  { verdict: "revise", action: "copy", summary: "Copy needs one revision.", findings: [] }
);
assert.throws(
  () => parseGenerationJudgeResult({ verdict: "ship", action: "copy", summary: "Invalid.", findings: [] }, ["copy", "operator_review"]),
  /Invalid literal value|invalid_literal/i
);
assert.throws(
  () => parseGenerationJudgeResult({ verdict: "revise", action: "alternate_system", summary: "Invalid.", findings: [] }, ["copy", "operator_review"]),
  /unavailable action/
);

console.log(JSON.stringify({ ok: true, schemas: 4, alternateSystemAvailability: "pack_owned" }, null, 2));
