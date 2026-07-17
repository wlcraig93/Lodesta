import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { getRenderInspectionRuntimeStatus } from "../lib/render-inspection";
import { runObjectiveGenerationGate } from "../lib/generation-objective-gate";
import { buildGenerationJudgePacket } from "../lib/generation-judge";
import { buildCanonicalFixture, loadCanonicalFixtureDefinitions } from "./canonical-generation-fixtures";

const runtime = await getRenderInspectionRuntimeStatus({ launch: true });
assert.equal(runtime.packageInstalled, true, runtime.message);
assert.equal(runtime.browserLaunchable, true, `${runtime.message} Run npm run install:browsers.`);

const captureSchemaVersion = "canonical-generation-review-v1";
const runId = `canonical-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
const artifactRoot = join(process.cwd(), ".data", "generation-review", runId);
await mkdir(artifactRoot, { recursive: true });
const results = [];

for (const definition of await loadCanonicalFixtureDefinitions()) {
  const fixture = await buildCanonicalFixture(definition);
  const gate = await runObjectiveGenerationGate({
    snapshot: fixture.snapshot,
    version: fixture.version,
    plan: fixture.plan,
    copy: fixture.copy,
    qaRunId: `qa_fixture_${definition.id}`,
    artifactRoot,
    captureScreenshots: true
  });
  assert.equal(
    gate.status,
    "pass",
    `${definition.id} objective gate failed:\n${gate.blockers.map((blocker) => `${blocker.id}: ${blocker.detail}`).join("\n")}`
  );
  assert.equal(gate.routes.length, fixture.version.pageComposition.pages.length);
  assert(gate.routes.every((route) => route.inspection.adapter === "playwright"));
  assert(gate.routes.every((route) => route.inspection.screenshots.length === 3));
  assert(gate.routes.every((route) => route.inspection.screenshots.every((screenshot) => (screenshot.bytes ?? 0) > 0)));
  const judgePacket = await buildGenerationJudgePacket({
    snapshot: fixture.snapshot,
    plan: fixture.plan,
    version: fixture.version,
    gate,
    artifactRoot
  });
  assert.equal(judgePacket.images.length, 4);
  assert(judgePacket.images.every((image) => image.bytes > 0 && image.imageUrl.startsWith("data:image/")));
  results.push({
    id: definition.id,
    businessName: fixture.business.name,
    designSystem: fixture.plan.designSystem,
    routes: gate.routes.length,
    screenshots: gate.routes.reduce((sum, route) => sum + route.inspection.screenshots.length, 0),
    judgePacketImages: judgePacket.images.length,
    warnings: gate.warnings.length,
    trace: { plans: 1, copies: 1, compiles: 1, gates: 1, judges: 0 },
    images: judgePacket.images.map((image) => ({
      id: image.id,
      label: image.label,
      path: relative(artifactRoot, image.path),
      bytes: image.bytes
    }))
  });
}

const manifest = {
  schemaVersion: captureSchemaVersion,
  runId,
  generatedAt: new Date().toISOString(),
  fixtureCount: results.length,
  fixtures: results
};
await writeFile(join(artifactRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, captureRoot: artifactRoot, fixtures: results }, null, 2));
