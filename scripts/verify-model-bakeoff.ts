import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  denverPlumberBakeoffCandidates,
  denverPlumberBakeoffId,
  denverPlumberBakeoffSources,
  createModelBakeoffRecords,
  modelBakeoffExperimentSchema,
  modelBakeoffRunSchema,
  primePlumbingRouteSmokeDefinition
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
const smoke = createModelBakeoffRecords(primePlumbingRouteSmokeDefinition("bakeoff_prime_route_smoke_verification"), now);
assert.equal(smoke.experiment.sources.length, 1);
assert.equal(smoke.experiment.candidates.length, 4);
assert.equal(smoke.runs.length, 4, "An arbitrary one-source/four-route matrix did not create four runs.");
assert.deepEqual(smoke.runs.map((run) => run.ordinal), [0, 1, 2, 3]);
const kimiRetry = createModelBakeoffRecords(
  primePlumbingRouteSmokeDefinition("bakeoff_prime_kimi_retry_verification", ["kimi_k3"]),
  now
);
assert.equal(kimiRetry.runs.length, 1, "A focused infrastructure retry could not retain an independent experiment.");
assert.equal(kimiRetry.runs[0]?.candidate.key, "kimi_k3");
assert.throws(
  () => primePlumbingRouteSmokeDefinition("bakeoff_prime_unknown_candidate", ["unknown"]),
  /Unknown or empty/,
  "An unestablished candidate key was accepted by the focused runner."
);

const [listPage, detailPage, runner, migration, middleware] = await Promise.all([
  readFile("app/(admin-app)/model-bakeoffs/page.tsx", "utf8"),
  readFile("app/(admin-app)/model-bakeoffs/[experimentId]/page.tsx", "utf8"),
  readFile("scripts/run-model-bakeoff.ts", "utf8"),
  readFile("supabase/migrations/202607250001_model_bakeoff.sql", "utf8"),
  readFile("middleware.ts", "utf8")
]);
assert(detailPage.includes("/api/site-versions/") && detailPage.includes("/artifact"), "The lab must use the private retained-artifact route.");
assert(detailPage.includes("Served model") && detailPage.includes("Build cost"), "The lab must expose served provenance and cost.");
assert(!listPage.includes("/12") && !detailPage.includes("/12") && !detailPage.includes("All twelve runs"), "The admin lab retained hard-coded twelve-run totals.");
assert(detailPage.includes("sources.length * view.experiment.candidates.length"), "The detail total is not derived from the experiment matrix.");
assert(runner.includes("creditExhausted") && runner.includes("MODEL_BAKEOFF_CONCURRENCY"), "The runner must be resumable and stop scheduling on credit exhaustion.");
assert(runner.includes("MODEL_BAKEOFF_EXPERIMENT_ID") && runner.includes("prime-route-smoke"), "The runner cannot create a fresh caller-supplied experiment.");
assert(runner.includes("MODEL_BAKEOFF_CANDIDATE_KEYS"), "The runner cannot isolate an infrastructure retry without rerunning successful cells.");
assert(runner.includes("MODEL_BAKEOFF_MAX_COST_USD"), "The smoke runner lost its explicit per-route authoring fuse.");
assert(middleware.includes('"/model-bakeoffs"'), "Custom-domain routing must preserve the platform-only bake-off lab.");
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
