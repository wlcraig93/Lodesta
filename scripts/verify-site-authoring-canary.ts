import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { z } from "zod";

const coverage = z.enum([
  "incomplete_sources",
  "multi_location",
  "weak_imagery",
  "conflicting_provisional",
  "mobile_layout"
]);
const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("site-authoring-visual-canary"),
  viewports: z.array(z.object({
    name: z.enum(["mobile", "desktop"]),
    width: z.number().int().positive(),
    height: z.number().int().positive()
  }).strict()).length(2),
  cases: z.array(z.object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    businessName: z.string().min(1),
    sourceUrl: z.string().url(),
    coverage: z.array(coverage).min(1),
    ownerAuthority: z.object({
      ownerOperationalRevision: z.number().int().positive(),
      ownerIntentRevision: z.number().int().positive()
    }).passthrough(),
    provisionalSources: z.array(z.object({
      kind: z.string().min(1),
      payload: z.record(z.string(), z.unknown())
    }).strict()).min(1),
    assetCondition: z.enum(["none", "weak", "mixed", "strong"]),
    reviewPrompts: z.array(z.string().min(1)).min(2)
  }).strict()).length(5)
}).strict();

const manifest = manifestSchema.parse(JSON.parse(
  await readFile("fixtures/site-authoring-canary/manifest.json", "utf8")
));
assert.equal(new Set(manifest.cases.map((item) => item.id)).size, manifest.cases.length);
assert.equal(new Set(manifest.cases.map((item) => item.businessName)).size, manifest.cases.length);
assert(manifest.cases.every((item) => new URL(item.sourceUrl).hostname.endsWith(".example")));
const covered = new Set(manifest.cases.flatMap((item) => item.coverage));
for (const required of coverage.options) {
  assert(covered.has(required), `Site-authoring canary is missing ${required}.`);
}
assert(manifest.viewports.some((viewport) => viewport.name === "mobile" && viewport.width <= 390));
assert(manifest.viewports.some((viewport) => viewport.name === "desktop" && viewport.width >= 1280));

process.stdout.write(`${JSON.stringify({
  ok: true,
  cases: manifest.cases.length,
  coverage: [...covered].sort(),
  fixtures: "synthetic_non_customer",
  review: "manual_visual_review_required_after_generation"
})}\n`);
