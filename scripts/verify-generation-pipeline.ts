import assert from "node:assert/strict";
import type { ObjectiveGenerationGateResult } from "../lib/generation-objective-gate";
import type { GenerationJudgePacket, GenerationJudgeResult } from "../lib/generation-judge";
import { createTestSiteCopy } from "../lib/test-support/site-copy";
import {
  runCanonicalGenerationPipeline,
  validateGenerationPipelineTrace,
  type GenerationPipelineTrace
} from "../lib/generation-pipeline";
import { createRegenerableArtifactProvenanceV1 } from "../lib/regenerable-artifact-provenance";
import { buildCanonicalFixture, loadCanonicalFixtureDefinitions } from "./canonical-generation-fixtures";

const definitions = await loadCanonicalFixtureDefinitions();
const mediaFixture = await buildCanonicalFixture(definitions[0]);
const noMediaFixture = await buildCanonicalFixture(definitions[3]);

const shipped = await runScenario(mediaFixture, [judge("ship", "none")]);
assert.equal(shipped.status, "ship");
assert.deepEqual(shipped.trace.counts, { plans: 1, copies: 1, copyModelAttempts: 1, compiles: 1, gates: 1, judges: 1 });

const copyRevision = await runScenario(mediaFixture, [judge("revise", "copy"), judge("ship", "none")]);
assert.equal(copyRevision.status, "ship");
assert.equal(copyRevision.plan.designSystem, "precision_shop_editorial");
assert.deepEqual(copyRevision.trace.counts, { plans: 1, copies: 2, copyModelAttempts: 2, compiles: 2, gates: 2, judges: 2 });

const systemRevision = await runScenario(mediaFixture, [judge("revise", "alternate_system"), judge("ship", "none")]);
assert.equal(systemRevision.status, "ship");
assert.equal(systemRevision.plan.designSystem, "trusted_local_service");
assert.deepEqual(systemRevision.trace.counts, { plans: 2, copies: 2, copyModelAttempts: 2, compiles: 2, gates: 2, judges: 2 });

const unavailableAlternate = await runScenario(noMediaFixture, [judge("revise", "alternate_system")]);
assert.equal(unavailableAlternate.status, "operator_review");
assert.equal(unavailableAlternate.reason, "alternate_system_unavailable");
assert.deepEqual(unavailableAlternate.trace.counts, { plans: 1, copies: 1, copyModelAttempts: 1, compiles: 1, gates: 1, judges: 1 });

const bounded = await runScenario(mediaFixture, [judge("revise", "copy"), judge("revise", "copy")]);
assert.equal(bounded.status, "operator_review");
assert.equal(bounded.reason, "regeneration_did_not_ship");
assert.equal(bounded.trace.counts.copies, 2);

assert.throws(
  () => validateGenerationPipelineTrace({
    ...copyRevision.trace,
    counts: { ...copyRevision.trace.counts, plans: 2 }
  }),
  /Copy regeneration must preserve/
);
assert.throws(
  () => validateGenerationPipelineTrace({
    ...systemRevision.trace,
    attempts: systemRevision.trace.attempts.map((attempt, index) => index === 1
      ? { ...attempt, designSystem: systemRevision.trace.attempts[0].designSystem }
      : attempt) as GenerationPipelineTrace["attempts"]
  }),
  /Alternate-system regeneration must change/
);

console.log(JSON.stringify({ ok: true, scenarios: 5, boundedRegenerations: 1, invalidTracesRejected: 2 }, null, 2));

async function runScenario(
  fixture: Awaited<ReturnType<typeof buildCanonicalFixture>>,
  judgments: GenerationJudgeResult[]
) {
  let judgeIndex = 0;
  return runCanonicalGenerationPipeline({
    snapshot: fixture.snapshot,
    dependencies: {
      copy: async ({ snapshot, plan }) => ({ copy: createTestSiteCopy(plan, snapshot), attempts: 1 }),
      gate: async ({ qaRunId }) => passingGate(qaRunId),
      packet: async ({ snapshot, plan }) => ({
        availableActions: ["copy", ...(plan.designSystem === "precision_shop_editorial" || snapshot.assets.length ? ["alternate_system" as const] : []), "operator_review"],
        images: [],
        textManifest: []
      }) satisfies GenerationJudgePacket,
      judge: async () => judgments[judgeIndex++] ?? judge("operator_review", "operator_review")
    }
  });
}

function passingGate(qaRunId: string): ObjectiveGenerationGateResult {
  return {
    schemaVersion: "objective-generation-gate-v1",
    status: "pass",
    evaluatedAt: "2026-07-16T00:00:00.000Z",
    qaRunId,
    blockers: [],
    warnings: [],
    routes: []
  };
}

function judge(
  verdict: GenerationJudgeResult["verdict"],
  action: GenerationJudgeResult["action"]
): GenerationJudgeResult {
  const common = {
    schemaVersion: "generation-judge-v1" as const,
    provenance: createRegenerableArtifactProvenanceV1({ producerId: "fixture-judge", producerVersion: "v1" }),
    source: "openai" as const,
    model: "fixture",
    evaluatedAt: "2026-07-16T00:00:00.000Z",
    screenshotCount: 4,
    summary: `${verdict}:${action}`,
    findings: verdict === "revise" ? [{ id: "fixture", area: "copy" as const, severity: "material" as const, pageId: "home", evidence: "Fixture finding.", instruction: "Revise the fixture copy." }] : []
  };
  if (verdict === "ship" && action === "none") return { ...common, verdict, action };
  if (verdict === "revise" && action !== "none") return { ...common, verdict, action };
  return { ...common, verdict: "operator_review", action: "operator_review" };
}
