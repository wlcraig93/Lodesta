import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  computeDefaultComposite,
  dimensionScores,
  filterMarketBenchmarkCandidates,
  runMarketBenchmark
} from "../lib/market-benchmark";

const runId = `fixture-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const result = await runMarketBenchmark({
  mode: "fixture",
  runId,
  limit: 50,
  render: true,
  screenshots: false
});

assert.ok(result.candidates.accepted.length >= 3, "Expected at least three accepted fixture candidates.");
assert.ok(result.candidates.rejected.some((candidate) => candidate.reasons.includes("dealer_or_sales_keyword")), "Expected dealer rejection.");
assert.ok(result.candidates.rejected.some((candidate) => candidate.reasons.includes("franchise_or_chain_keyword")), "Expected franchise rejection.");
assert.ok(result.candidates.rejected.some((candidate) => candidate.reasons.includes("duplicate_website_url")), "Expected duplicate URL rejection.");
assert.ok(result.candidates.needsReview.some((candidate) => candidate.reasons.includes("listing_or_social_profile_url")), "Expected listing/social needs-review candidate.");

const fixtureHtml = await readFile(join(process.cwd(), "fixtures", "market-benchmark", "austin-auto", "sites", "austin-dent-paint.html"), "utf8");
assert.equal(/data-section|data-primary-hero-cta|site-visual/i.test(fixtureHtml), false, "Fixture HTML should not use Lodesta-specific markers.");

const high = result.siteResults.find((site) => site.candidate.name === "Austin Dent & Paint");
const poor = result.siteResults.find((site) => site.candidate.name === "Austin Auto Glass Express");
assert.ok(high, "Expected Austin Dent & Paint fixture result.");
assert.ok(poor, "Expected Austin Auto Glass Express fixture result.");
assert.ok(high.scores.composites.defaultComposite > poor.scores.composites.defaultComposite, "Expected stronger fixture to outrank weaker fixture.");

for (const site of result.siteResults) {
  const scores = dimensionScores(site.scores.dimensions);
  for (const [dimension, score] of Object.entries(scores)) {
    assert.ok(score >= 0 && score <= 100, `${site.candidate.name} ${dimension} score must be 0-100.`);
  }
  assert.equal(computeDefaultComposite(scores), site.scores.composites.defaultComposite, "Composite must be recomputable from dimensions.");
}

assert.ok(high.sections.sections.some((section) => section.type === "services"), "Expected services section classification.");
assert.ok(high.sections.sections.some((section) => section.type === "gallery_before_after"), "Expected gallery/before-after section classification.");
assert.ok(high.sections.sections.some((section) => section.type === "quote_contact"), "Expected quote/contact section classification.");
assert.ok(poor.sections.sections.some((section) => section.type === "unknown"), "Expected weak fixture to preserve unknown geometry.");

const filtered = filterMarketBenchmarkCandidates(result.candidates.accepted, { limit: 1 });
assert.equal(filtered.accepted.length, 1, "Accepted limit should cap candidates.");
assert.ok(filtered.rejected.some((candidate) => candidate.reasons.includes("accepted_limit_reached")), "Expected limit overflow rejection.");

const report = await readFile(result.reportPath, "utf8");
assert.ok(report.includes("## Automated Facts"), "Report should separate automated facts.");
assert.ok(report.includes("## Inferred Classifications"), "Report should separate inferred classifications.");
assert.ok(report.includes("## Low-Confidence Geometry"), "Report should separate low-confidence geometry.");
assert.ok(report.includes("## Human Review Recommendations"), "Report should include human-review recommendations.");
assert.ok(report.includes("## Candidate Lodesta Template Or Recipe Gaps"), "Report should include candidate Lodesta gaps.");

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      runId: result.runId,
      artifactRoot: result.artifactRoot,
      reportPath: result.reportPath,
      accepted: result.candidates.accepted.length,
      rejected: result.candidates.rejected.length,
      needsReview: result.candidates.needsReview.length,
      scored: result.siteResults.length
    },
    null,
    2
  )}\n`
);
