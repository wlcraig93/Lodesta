import assert from "node:assert/strict";
import { createSiteV3FromInput } from "../lib/intake";
import { compileGeneratedSiteV3Site } from "../lib/generated-site-v3-compiler";
import { inspectGeneratedSiteBundleRender, renderGeneratedSiteHtml } from "../lib/generated-site-render-inspection";
import {
  generatedSiteVerticalQualityProfileForBusinessV1,
  mediaSuitabilityForProfileV1,
  semanticDedupeServiceItemsForProfileV1
} from "../lib/generated-site-v3-quality-profiles";
import type {
  AssetAnalysisV1,
  AssetReference,
  BusinessProfile,
  RenderInspectionFinding,
  SiteBundle,
  Vertical
} from "../lib/models";
import type { StandardItemV3 } from "../lib/generated-site-v3-visual-controls";

const defaultProfileFixtures = [
  {
    id: "default_profile_home_services",
    vertical: "home_services",
    prompt:
      "Build a website for Hearthside Home Repair, a local home services company in Knoxville offering handyman repair, drywall patching, faucet replacement, door repair, and seasonal maintenance. phone: 865-555-0117. address: 215 Central Street, Knoxville, TN 37902.",
    name: "Hearthside Home Repair",
    categories: ["Home services", "Handyman"],
    description:
      "Hearthside Home Repair helps Knoxville homeowners with small repair lists, drywall patching, faucet replacement, door adjustments, and seasonal maintenance.",
    services: ["Handyman repair", "Drywall patching", "Faucet replacement", "Door repair", "Seasonal maintenance"],
    phone: "(865) 555-0117",
    email: "hello@hearthsidehome.example",
    address: { street: "215 Central Street", city: "Knoxville", region: "TN", postalCode: "37902", country: "US" }
  },
  {
    id: "default_profile_law_firm",
    vertical: "law_firm",
    prompt:
      "Build a website for Park & Cedar Law, a small estate planning and probate law office in Des Moines offering wills, trusts, probate guidance, and family business planning. phone: 515-555-0196. address: 440 Locust Street, Des Moines, IA 50309.",
    name: "Park & Cedar Law",
    categories: ["Law firm", "Estate planning"],
    description:
      "Park & Cedar Law helps families with wills, trusts, probate questions, and planning conversations for property and family businesses.",
    services: ["Wills", "Trusts", "Probate guidance", "Family business planning"],
    phone: "(515) 555-0196",
    email: "intake@parkcedarlaw.example",
    address: { street: "440 Locust Street", city: "Des Moines", region: "IA", postalCode: "50309", country: "US" }
  }
] satisfies Array<{
  id: string;
  vertical: Vertical;
  prompt: string;
  name: string;
  categories: string[];
  description: string;
  services: string[];
  phone: string;
  email: string;
  address: NonNullable<BusinessProfile["address"]>;
}>;

const autoBodyProfile = generatedSiteVerticalQualityProfileForBusinessV1({ vertical: "auto_body" });
const defaultProfile = generatedSiteVerticalQualityProfileForBusinessV1({ vertical: "general_local" });

assert.equal(autoBodyProfile.id, "auto_body", "Auto-body businesses should use the tuned auto-body profile.");
assert.equal(defaultProfile.id, "default_local_service", "Untuned verticals should use the default local-service profile.");

async function verifyDefaultProfileRenderPath() {
  for (const fixture of defaultProfileFixtures) {
    const bundle = fixtureBundle(fixture);
    const { version } = compileGeneratedSiteV3Site({ bundle, createdAt: "2026-06-18T00:00:00.000Z" });
    bundle.siteModel.versions = [version];

    const profileDecision = version.compilerDecisions?.find((decision) => decision.kind === "quality_profile_assignment");
    assert.equal(profileDecision?.resolvedValue, "default_local_service", `${fixture.id} should record default profile assignment.`);
    assert.equal(profileDecision?.severity, "info", `${fixture.id} profile assignment should be informational.`);

    const html = await renderGeneratedSiteHtml(bundle, version);
    assert.equal(/generic visuals|source-backed|proof section|visual context/i.test(stripHtml(html)), false, `${fixture.id} should not render internal media-policy language.`);

    const inspection = await inspectGeneratedSiteBundleRender({
      bundle,
      version,
      qaRunId: `quality_profile_${fixture.id}`,
      captureScreenshots: false,
      captureSectionScreenshots: false
    });
    assert.equal(
      inspection.adapter,
      "playwright",
      `${fixture.id} should run through Playwright render inspection: ${inspection.unavailableReason ?? "no fallback reason"}`
    );
    const hardFailures = inspection.findings.filter(isIntrinsicRenderFailure);
    assert.equal(
      hardFailures.length,
      0,
      `${fixture.id} default profile render failures:\n${hardFailures.map((finding) => `${finding.id}${finding.viewport ? `.${finding.viewport}` : ""}: ${finding.evidence}`).join("\n")}`
    );
  }
}

function verifyAutoBodyServicePolicy() {
  const sourceItems: StandardItemV3[] = [
    { title: "Collision repair", body: "We inspect the damaged area, related panels, and next repair steps." },
    { title: "Auto body repair", body: "We inspect the damaged area, related panels, and next repair steps." },
    { title: "Professional paint services", body: "Paint work starts with color match, prep, and finish expectations." },
    { title: "Paint refinishing", body: "Paint work starts with color match, prep, and finish expectations." },
    { title: "Free Repair Quote", body: "Request a quick estimate before you choose a repair path." }
  ];
  const deduped = semanticDedupeServiceItemsForProfileV1({ profile: autoBodyProfile, items: sourceItems });
  assert.ok(deduped.decisions.some((decision) => decision.kind === "service_semantic_dedupe"), "Auto-body service policy should record semantic service dedupe decisions.");
  assert.equal(deduped.items.some((item) => /free repair quote/i.test(item.title)), false, "Pseudo-service quote items should not survive as service cards.");
  assert.equal(deduped.items.filter((item) => /impact|body|collision/i.test(item.title)).length, 1, "Collision/body equivalents should collapse to one service group.");
  assert.equal(deduped.items.filter((item) => /paint|refinish/i.test(item.title)).length, 1, "Paint/refinish equivalents should collapse to one service group.");
}

function verifyAssetClassifierFixtureSet() {
  const criticalWarnings = new Set(autoBodyProfile.proof.blockedWarnings);
  const falseNegatives: string[] = [];
  const falsePositives: string[] = [];

  for (const fixture of labeledAssetFixtures) {
    const warningSet = new Set(fixture.asset.analysisV1?.warnings ?? []);
    for (const expected of fixture.expectedWarnings) {
      if (!warningSet.has(expected)) falseNegatives.push(`${fixture.id}: missing ${expected}`);
    }
    if (fixture.expectedProofAllowed) {
      for (const warning of warningSet) {
        if (criticalWarnings.has(warning)) falsePositives.push(`${fixture.id}: unexpected blocking warning ${warning}`);
      }
    }

    const business = profileBusinessWithPhotos([fixture.asset]);
    const suitability = mediaSuitabilityForProfileV1({
      profile: autoBodyProfile,
      business,
      item: { url: fixture.asset.url, label: fixture.asset.alt },
      slot: "proof"
    });
    assert.equal(
      suitability.allowed,
      fixture.expectedProofAllowed,
      `${fixture.id} proof suitability should be ${fixture.expectedProofAllowed ? "allowed" : "blocked"}${suitability.allowed ? "" : ` (${suitability.reason})`}.`
    );
  }

  assert.equal(falseNegatives.length, 0, `AssetAnalysisV1 fixture false negatives:\n${falseNegatives.join("\n")}`);
  assert.equal(falsePositives.length, 0, `AssetAnalysisV1 fixture false positives:\n${falsePositives.join("\n")}`);
}

function fixtureBundle(fixture: (typeof defaultProfileFixtures)[number]): SiteBundle {
  const bundle = createSiteV3FromInput({ prompt: fixture.prompt, identity: { siteId: `site_${fixture.id}` } });
  const business: BusinessProfile = {
    ...bundle.businessProfile,
    id: `biz_${fixture.id}`,
    siteId: `site_${fixture.id}`,
    name: fixture.name,
    vertical: fixture.vertical,
    categories: fixture.categories,
    description: fixture.description,
    phone: fixture.phone,
    email: fixture.email,
    address: fixture.address,
    hours: {
      monday: "9:00am - 5:00pm",
      tuesday: "9:00am - 5:00pm",
      wednesday: "9:00am - 5:00pm",
      thursday: "9:00am - 5:00pm",
      friday: "9:00am - 5:00pm"
    },
    services: fixture.services,
    serviceHighlights: fixture.services,
    serviceAreas: [fixture.address.city],
    socialLinks: [],
    bookingLinks: [],
    orderingLinks: [],
    photos: [],
    pressLinks: [],
    provenance: bundle.businessProfile.provenance
  };
  return {
    ...bundle,
    businessProfile: business,
    locations: [
      {
        id: `loc_${fixture.id}`,
        businessId: business.id,
        label: "Office",
        address: fixture.address,
        serviceAreas: [fixture.address.city],
        phone: fixture.phone,
        email: fixture.email,
        hours: business.hours,
        provenance: {},
        createdAt: "2026-06-18T00:00:00.000Z",
        updatedAt: "2026-06-18T00:00:00.000Z"
      }
    ],
    locationBindings: [{ locationId: `loc_${fixture.id}`, role: "primary", orderIndex: 0 }]
  };
}

function profileBusinessWithPhotos(photos: AssetReference[]): Pick<BusinessProfile, "photos"> {
  return { photos };
}

function isIntrinsicRenderFailure(finding: RenderInspectionFinding) {
  return (
    finding.severity === "fail" &&
    /render\.(horizontal_overflow|section_media_overflow|form_affordance|console_errors|primary_hero_cta_visible|hero_h1_fit|hero_h1_lines|cramped_text_columns)/.test(
      finding.id
    )
  );
}

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const labeledAssetFixtures: LabeledAssetFixture[] = [
  {
    id: "mencia_text_overlay_before_after",
    expectedWarnings: ["text_overlay", "logo_like"],
    expectedProofAllowed: false,
    asset: assetFixture("mencia_text_overlay_before_after", "Before & after repairs with text overlays", "before_after", ["text_overlay", "logo_like", "awkward_empty_space"], ["gallery"])
  },
  {
    id: "mencia_collage_composite",
    expectedWarnings: ["collage_or_composite", "logo_like"],
    expectedProofAllowed: false,
    asset: assetFixture("mencia_collage_composite", "Before and after collage", "before_after", ["collage_or_composite", "logo_like"], ["gallery"])
  },
  {
    id: "logo_tile_screenshot",
    expectedWarnings: ["logo_like", "text_overlay"],
    expectedProofAllowed: false,
    asset: assetFixture("logo_tile_screenshot", "Logo tile graphic screenshot", "text_heavy_graphic", ["logo_like", "text_overlay"], ["logo"])
  },
  {
    id: "clean_panel_detail",
    expectedWarnings: [],
    expectedProofAllowed: true,
    asset: assetFixture("clean_panel_detail", "Clean panel repair detail", "repair_detail", [], ["hero", "service", "proof", "gallery"])
  },
  {
    id: "clean_shop_environment",
    expectedWarnings: [],
    expectedProofAllowed: false,
    asset: assetFixture("clean_shop_environment", "Shop environment without visible customer repair outcome", "interior", [], ["hero", "service", "gallery"])
  }
];

function assetFixture(
  id: string,
  alt: string,
  imageKind: AssetAnalysisV1["imageKind"],
  warnings: AssetAnalysisV1["warnings"],
  usableSlots: AssetAnalysisV1["usableSlots"]
): AssetReference {
  return {
    id,
    url: `/fixture-assets/${id}.jpg`,
    alt,
    source: "website_reference",
    rightsStatus: "reference_only",
    width: 1200,
    height: 800,
    analysisV1: {
      version: "asset-analysis-v1",
      source: "openai",
      model: "fixture",
      analyzedAt: "2026-06-18T00:00:00.000Z",
      imageKind,
      qualityScore: warnings.includes("low_resolution") || imageKind === "low_quality" ? 28 : 82,
      usableSlots,
      focalPoint: "center",
      subjectPlacement: "centered",
      recommendedCropIntent: imageKind === "repair_detail" ? "detail_zoom" : "wide",
      cropRecommendations: {
        wide: { focalPoint: "center", cropIntent: "wide", suitability: 82 },
        square: { focalPoint: "center", cropIntent: "center", suitability: 72 },
        portrait: { focalPoint: "center", cropIntent: "portrait", suitability: 60 },
        card: { focalPoint: "center", cropIntent: "subject", suitability: 78 }
      },
      warnings,
      contentTags: imageKind === "repair_detail" ? ["auto-body", "repair-detail"] : ["auto-body"],
      summary: `${alt} classified as ${imageKind}.`,
      limitations: []
    }
  };
}

type LabeledAssetFixture = {
  id: string;
  expectedWarnings: AssetAnalysisV1["warnings"];
  expectedProofAllowed: boolean;
  asset: AssetReference;
};

verifyAssetClassifierFixtureSet();
verifyAutoBodyServicePolicy();
await verifyDefaultProfileRenderPath();

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      defaultProfileFixtures: defaultProfileFixtures.length,
      classifierFixtures: labeledAssetFixtures.length,
      profileIds: ["auto_body", "default_local_service"]
    },
    null,
    2
  )}\n`
);
