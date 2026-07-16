import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRenderInspectionRuntimeStatus } from "../lib/render-inspection";
import { runObjectiveGenerationGate } from "../lib/generation-objective-gate";
import { buildCanonicalFixture, loadCanonicalFixtureDefinitions } from "./canonical-generation-fixtures";

const runtime = await getRenderInspectionRuntimeStatus({ launch: true });
assert.equal(runtime.packageInstalled, true, runtime.message);
assert.equal(runtime.browserLaunchable, true, `${runtime.message} Run npm run install:browsers.`);

const artifactRoot = await mkdtemp(join(tmpdir(), "lodesta-canonical-render-"));
const results = [];

try {
  for (const definition of await loadCanonicalFixtureDefinitions()) {
    const fixture = await buildCanonicalFixture(definition);
    const gate = await runObjectiveGenerationGate({
      bundle: fixture.bundle,
      version: fixture.version,
      plan: fixture.plan,
      copy: fixture.copy,
      evidence: fixture.evidence,
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
    results.push({
      id: definition.id,
      designSystem: fixture.plan.designSystem,
      routes: gate.routes.length,
      screenshots: gate.routes.reduce((sum, route) => sum + route.inspection.screenshots.length, 0),
      warnings: gate.warnings.length,
      trace: { plans: 1, copies: 1, compiles: 1, gates: 1, judges: 0 }
    });
  }
} finally {
  await rm(artifactRoot, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, fixtures: results }, null, 2));
