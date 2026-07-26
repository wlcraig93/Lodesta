import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  denverPlumberBakeoffCandidates,
  denverPlumberBakeoffId,
  denverPlumberBakeoffSources,
  modelBakeoffExperimentSchema,
  modelBakeoffRunSchema
} from "@/packages/model-bakeoff";

assert.equal(denverPlumberBakeoffSources.length, 3, "The pilot must compare exactly three source profiles.");
assert.equal(denverPlumberBakeoffCandidates.length, 4, "The pilot must compare exactly four authoring routes.");
assert.deepEqual(
  denverPlumberBakeoffCandidates.map((candidate) => `${candidate.apiProvider}:${candidate.modelId}`),
  [
    "openai:gpt-5.6-sol",
    "openai:gpt-5.6-terra",
    "openrouter:anthropic/claude-opus-5",
    "openrouter:moonshotai/kimi-k3"
  ],
  "The pilot authoring routes changed without updating the experiment contract."
);

const now = new Date().toISOString();
modelBakeoffExperimentSchema.parse({
  schemaVersion: 1,
  id: denverPlumberBakeoffId,
  name: "Verification fixture",
  purpose: "Verify the retained model bake-off contract.",
  requestedBy: "verification",
  status: "queued",
  sources: denverPlumberBakeoffSources,
  candidates: denverPlumberBakeoffCandidates,
  createdAt: now,
  updatedAt: now
});
const ids = new Set<string>();
for (const [sourceIndex, source] of denverPlumberBakeoffSources.entries()) {
  for (const [candidateIndex, candidate] of denverPlumberBakeoffCandidates.entries()) {
    const item = modelBakeoffRunSchema.parse({
      schemaVersion: 1,
      id: `${denverPlumberBakeoffId}:${source.key}:${candidate.key}`,
      experimentId: denverPlumberBakeoffId,
      ordinal: sourceIndex * denverPlumberBakeoffCandidates.length + candidateIndex,
      source,
      candidate,
      status: "queued",
      createdAt: now,
      updatedAt: now
    });
    assert(!ids.has(item.id), `Duplicate bake-off item: ${item.id}`);
    ids.add(item.id);
  }
}
assert.equal(ids.size, 12, "The pilot matrix must contain exactly twelve unique runs.");

const [detailPage, runner, migration] = await Promise.all([
  readFile("app/(admin-app)/model-bakeoffs/[experimentId]/page.tsx", "utf8"),
  readFile("scripts/run-model-bakeoff.ts", "utf8"),
  readFile("supabase/migrations/202607250001_model_bakeoff.sql", "utf8")
]);
assert(detailPage.includes("/api/site-versions/") && detailPage.includes("/artifact"), "The lab must use the private retained-artifact route.");
assert(detailPage.includes("Served model") && detailPage.includes("Build cost"), "The lab must expose served provenance and cost.");
assert(runner.includes("creditExhausted") && runner.includes("MODEL_BAKEOFF_CONCURRENCY"), "The runner must be resumable and stop scheduling on credit exhaustion.");
assert(
  runner.includes('row.status === "building"') && runner.includes('row.failureCode === "platform_version_mismatch"'),
  "Interrupted and shared-platform mismatch cells must be safely resumable."
);
assert(migration.includes("enable row level security") && migration.includes("revoke all on table public.model_bakeoff"), "Bake-off records must remain service-role only.");

console.log(JSON.stringify({
  ok: true,
  experimentId: denverPlumberBakeoffId,
  sources: denverPlumberBakeoffSources.length,
  candidates: denverPlumberBakeoffCandidates.length,
  runs: ids.size
}));
