import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BusinessProfile, FieldProvenance, SiteAsset } from "../lib/models";
import { summarizeCrawlHtml } from "../lib/crawler";
import { composeEvidenceLedger, type EvidenceProposal } from "../lib/evidence-ledger";
import { buildGenerationPlan } from "../lib/vertical-packs";
import { createFixtureSiteCopy } from "../lib/site-copy";
import { compileSite } from "../lib/site-compiler";
import { assertVisualSectionsForVersionV3 } from "../lib/site-version-v3";
import { validateSiteCopyForPlan, type ShippingDesignSystemId } from "../lib/generation-contracts";
import { slugify } from "../lib/slug";

type Manifest = {
  fixtures: Array<{
    id: string;
    sourceUrl: string;
    htmlPath: string;
    profile: string;
    expectedDesignSystem: ShippingDesignSystemId;
    evidenceProposals: Array<Omit<EvidenceProposal, "sourceUrl">>;
  }>;
};

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, "fixtures/generation-pipeline/four-fixture-manifest.json"), "utf8")) as Manifest;
assert.equal(manifest.fixtures.length, 4);
const results = [];

for (const fixture of manifest.fixtures) {
  const html = await readFile(path.join(root, fixture.htmlPath), "utf8");
  const page = summarizeCrawlHtml(html, fixture.sourceUrl);
  const crawl = { pageSummaries: [page] } as Parameters<typeof composeEvidenceLedger>[0]["crawl"];
  const evidence = composeEvidenceLedger({
    crawl,
    proposals: fixture.evidenceProposals.map((proposal) => ({ ...proposal, sourceUrl: fixture.sourceUrl })),
    createdAt: "2026-07-16T00:00:00.000Z"
  });
  const business = businessFromFixture(fixture.id, fixture.sourceUrl, page);
  const assets = assetsFromFixture(business.siteId, page, html, fixture.expectedDesignSystem === "precision_shop_editorial");
  const plan = buildGenerationPlan({ business, evidence, assets, createdAt: "2026-07-16T00:00:00.000Z" });
  assert.equal(plan.designSystem, fixture.expectedDesignSystem, `${fixture.id} selected the wrong design system.`);
  const copy = createFixtureSiteCopy(plan, business);
  const copyValidation = validateSiteCopyForPlan(plan, copy);
  assert.equal(copyValidation.ok, true, copyValidation.issues.join("\n"));
  const version = compileSite({ business, plan, copy, evidence, assets, createdAt: "2026-07-16T00:00:00.000Z" });
  assertVisualSectionsForVersionV3(version);
  assert.equal(version.pageComposition.pages.length, 1 + Math.min(3, business.services.length));
  results.push({
    id: fixture.id,
    designSystem: plan.designSystem,
    pages: version.pageComposition.pages.length,
    sections: version.pageComposition.pages.reduce((sum, candidate) => sum + candidate.sections.length, 0),
    evidenceAccepted: evidence.yield.accepted,
    evidenceRejected: evidence.yield.rejected,
    trace: { plans: 1, copies: 1, compiles: 1, gates: 0, judges: 0 }
  });
}

console.log(JSON.stringify({ ok: true, fixtures: results }, null, 2));

function businessFromFixture(id: string, sourceUrl: string, page: ReturnType<typeof summarizeCrawlHtml>): BusinessProfile {
  const facts = page.extractedFacts;
  const name = facts.name ?? page.title?.split("|")[0]?.trim() ?? id;
  const siteId = `site_fixture_${slugify(id)}`;
  const observedAt = "2026-07-16T00:00:00.000Z";
  const provenance = (field: string): FieldProvenance => ({ source: "website", sourceUrl, confidence: 0.9, verified: false, observedAt });
  const services = facts.services.length ? facts.services : page.mainText?.match(/windshield/i) ? ["Windshield Repair", "Window Replacement"] : ["Auto Body Repair"];
  return {
    id: `bp_${slugify(id)}`,
    siteId,
    name,
    vertical: "auto_body",
    categories: facts.categories.length ? facts.categories : ["Auto Body Shop"],
    description: facts.description ?? page.metaDescription,
    phone: facts.phone,
    email: facts.email,
    address: facts.address,
    geo: facts.geo,
    hours: facts.hours,
    services,
    serviceHighlights: facts.serviceHighlights ?? [],
    serviceAreas: facts.serviceAreas.length ? facts.serviceAreas : facts.address?.city ? [facts.address.city] : [],
    socialLinks: facts.socialLinks,
    bookingLinks: facts.bookingLinks,
    orderingLinks: facts.orderingLinks,
    photos: [],
    pressLinks: facts.pressLinks,
    reviewsSummary: facts.reviewsSummary,
    provenance: {
      name: provenance("name"),
      ...(facts.phone ? { phone: provenance("phone") } : {}),
      ...(facts.address ? { address: provenance("address") } : {}),
      services: provenance("services")
    }
  };
}

function assetsFromFixture(siteId: string, page: ReturnType<typeof summarizeCrawlHtml>, html: string, allowHero: boolean): SiteAsset[] {
  if (!allowHero) return [];
  const retained = page.assetReferences.filter((asset) => asset.kind === "image").slice(0, 1);
  const embeddedUrl = html.match(/<img[^>]+src=(["'])(.*?)\1/i)?.[2];
  const sourceAssets = retained.length ? retained : embeddedUrl ? [{ url: embeddedUrl, alt: "Source business repair photo" }] : [];
  return sourceAssets.map((asset, index) => ({
    id: `asset_fixture_${index + 1}`,
    siteId,
    kind: "photo",
    url: asset.url,
    alt: asset.alt ?? "Source business photo",
    source: "website_reference",
    rightsStatus: "preclaim_safe",
    usageScope: "preclaim_preview",
    ownerApproved: false,
    metadata: { analysisV1: { imageKind: "repair_detail", warnings: [] } },
    createdAt: "2026-07-16T00:00:00.000Z"
  }));
}
