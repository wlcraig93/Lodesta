import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sourceSnapshotSchema } from "../packages/site-contracts";
import { retainedCanarySourceIsAvailable } from "../packages/site-platform/workflow";

const snapshot = (sourceType: "website" | "web_research") => sourceSnapshotSchema.parse({
  schemaVersion: 1,
  id: `source_${sourceType}`,
  businessId: "business_test",
  sourceType,
  ...(sourceType === "website" ? { sourceUrl: "https://example.com/" } : {}),
  contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  capturedAt: "2026-09-04T00:00:00.000Z",
  payload: {}
});

assert.equal(retainedCanarySourceIsAvailable(snapshot("website"), 0), false);
assert.equal(retainedCanarySourceIsAvailable(snapshot("website"), 1), true);
assert.equal(retainedCanarySourceIsAvailable(snapshot("web_research"), 0), true);
assert.equal(retainedCanarySourceIsAvailable(undefined, 1), false);

const workflow = await readFile("packages/site-platform/workflow.ts", "utf8");
const retainedCanary = workflow.match(/async bootstrapFromRetainedSite[\s\S]*?\n  async prepareSession/)?.[0] ?? "";
assert.match(retainedCanary, /sourceMirrorReferences:/, "The canonical canary does not bind scratch authorities to retained mirrors.");
assert.match(retainedCanary, /retainedSourceSnapshotId:/, "The canonical canary does not identify the pinned retained mirror.");
assert.match(retainedCanary, /retainedCanarySourceIsAvailable\(snapshot, pages\.length\)/, "The canonical canary does not preserve page-free structured authorities.");
assert.doesNotMatch(retainedCanary, /saveSourceSnapshotResources\(/, "The canonical canary still clones retained resource rows.");
assert.doesNotMatch(retainedCanary, /saveSourceSnapshotPages\(/, "The canonical canary still clones retained page rows.");
assert.doesNotMatch(workflow, /function cloneSourceMirror\(/, "The obsolete full-mirror clone path still exists.");

const migration = await readFile("supabase/migrations/202608080001_shared_retained_source_mirrors.sql", "utf8");
assert.match(migration, /source_snapshot_mirror_references/);
assert.match(migration, /retain_website_source_snapshot_reference/);
assert.match(migration, /find_reusable_website_source_snapshot/);
assert.match(migration, /source_snapshot_reference_cannot_own_mirror_rows/);
assert.match(migration, /on delete restrict/);

process.stdout.write(`${JSON.stringify({ ok: true, runner: "pins-retained-mirror", rowCloning: false, pageFreeStructuredAuthority: true })}\n`);
