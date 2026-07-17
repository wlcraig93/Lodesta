import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CrawlAssessment } from "../lib/crawler";
import { summarizeCrawlHtml } from "../lib/crawler";
import {
  composeGenerationEvidenceManifestV1,
  verifyEvidenceProposal,
  type EvidenceProposal
} from "../lib/generation-evidence-manifest";
import { extractSourceTextBlocks } from "../lib/source-text-blocks";

type FixtureManifest = {
  schemaVersion: "generation-fixture-manifest-v1";
  fixtures: Array<{ id: string; sourceUrl: string; htmlPath: string; profile: string }>;
};

const root = process.cwd();
const manifest = JSON.parse(
  await readFile(path.join(root, "fixtures/generation-pipeline/four-fixture-manifest.json"), "utf8")
) as FixtureManifest;
assert.equal(manifest.fixtures.length, 4, "The canonical fixture gate requires exactly four source fixtures.");

const fixtureResults = [];
for (const fixture of manifest.fixtures) {
  const html = await readFile(path.join(root, fixture.htmlPath), "utf8");
  const summary = summarizeCrawlHtml(html, fixture.sourceUrl);
  assert.ok(summary.sourceTextBlocks.length > 0, `${fixture.id} must retain source text blocks.`);
  assert.ok(
    summary.sourceTextBlocks.every((block) => block.canonicalTokens.every((token) => token.displayEnd > token.displayStart)),
    `${fixture.id} tokens must map back to non-empty display spans.`
  );
  const crawl = { pageSummaries: [summary] } as CrawlAssessment;
  const ledger = composeGenerationEvidenceManifestV1({ crawl, createdAt: "2026-07-16T00:00:00.000Z" });
  fixtureResults.push({
    id: fixture.id,
    blocks: summary.sourceTextBlocks.length,
    evidenceAccepted: ledger.yield.accepted,
    evidenceRejected: ledger.yield.rejected,
    sourceSparse: ledger.yield.sourceSparse
  });
}

const offsetHtml = `<main><p>“Excellent&nbsp;paint <strong>match</strong> &amp; regular updates from start to finish.”</p><p>Alex R.</p></main>`;
const offsetUrl = "https://offsets.example/reviews";
const offsetBlocks = extractSourceTextBlocks(offsetHtml, offsetUrl);
const testimonial: EvidenceProposal = {
  kind: "testimonial",
  proposedText: "Excellent paint match & regular updates from start to finish.",
  sourceUrl: offsetUrl,
  attribution: "Alex R."
};
const verifiedTestimonial = verifyEvidenceProposal(testimonial, offsetBlocks);
assert.equal(verifiedTestimonial.ok, true, "Entity decoding and inline elements must preserve a verifiable token span.");
if (verifiedTestimonial.ok) {
  assert.equal(verifiedTestimonial.item.sourceExcerpt, "Excellent paint match & regular updates from start to finish");
  assert.equal(verifiedTestimonial.item.attribution, "Alex R.");
  assert.equal(verifiedTestimonial.item.publicText, verifiedTestimonial.item.sourceExcerpt);
}

const negativeHtml = `<main><p>We no longer offer a lifetime warranty on paint work.</p></main>`;
const negativeUrl = "https://negative.example/warranty";
const negativeResult = verifyEvidenceProposal(
  { kind: "warranty", proposedText: "lifetime warranty", sourceUrl: negativeUrl },
  extractSourceTextBlocks(negativeHtml, negativeUrl)
);
assert.equal(negativeResult.ok, true, "A source-exact sensitive claim remains available for protected owner review.");
if (negativeResult.ok) {
  assert.equal(negativeResult.item.renderPolicy, "protected_preview");
  assert.equal(negativeResult.item.publicText, undefined);
}

const paraphraseResult = verifyEvidenceProposal(
  { kind: "insurance_support", proposedText: "Insurance claim assistance", sourceUrl: negativeUrl },
  extractSourceTextBlocks(`<main><p>We coordinate repair supplements with your insurer.</p></main>`, negativeUrl)
);
assert.deepEqual(paraphraseResult, { ok: false, reason: "quote_not_contiguous" });

console.log(JSON.stringify({ ok: true, fixtures: fixtureResults }, null, 2));
