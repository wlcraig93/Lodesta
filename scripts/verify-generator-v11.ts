import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseRobotsTxt, summarizeCrawlHtml, type CrawlAssessment } from "../lib/crawler";
import { createSiteFromInput } from "../lib/intake";
import { SiteRenderer } from "../lib/site-renderer";
import { createAndStoreSite, createPreviewToken } from "../lib/store";
import { blockersFromSiteModel } from "../lib/generated-site-qa";
import { runInitialGeneratedSiteReadiness } from "../lib/generated-site-readiness";
import { createGenerationPlanV2 } from "../lib/generation-plan-v2";
import {
  applyDeterministicGeneratedSiteRepair,
  maxAiGeneratedSiteRepairRetries,
  shouldAttemptAiGeneratedSiteRepair
} from "../lib/generated-site-repair";
import { computeSiteModelHash, getEffectiveGenerationQaReadiness } from "../lib/site-version-metadata";
import { verticalImageRegistryCoverage } from "../lib/image-registry";
import { verticalRecipes } from "../lib/recipes";
import { isMockupImageGenerationAllowed, isModelVisualQaAllowed, planGenerationCost } from "../lib/generation-cost";
import {
  applyPropsToLayoutSection,
  propsForLayoutSection,
  repairLayoutDocument,
  sectionFromLayoutSection,
  validateLayoutDocument
} from "../lib/layout-registry";

const autoBodyCrawl: CrawlAssessment = {
  url: "https://super-b-paintandbody.example",
  fetched: true,
  status: 200,
  finalUrl: "https://super-b-paintandbody.example/",
  title: "Super-B Paint and Body | Collision Repair",
  metaDescription: "Collision repair, paint repair, bumper repair, and estimates.",
  canonical: "https://super-b-paintandbody.example/",
  hasViewportMeta: true,
  hasLocalBusinessSchema: true,
  hasTelLink: true,
  robotsFound: true,
  sitemapFound: true,
  formCount: 1,
  imageCount: 4,
  imagesWithoutAlt: 0,
  internalLinkCount: 8,
  externalLinkCount: 1,
  jsonLdTypes: ["AutoRepair", "LocalBusiness"],
  extractedFacts: {
    name: "Super-B Automotive Repair",
    description: "Auto body and collision repair shop.",
    phone: "+15555550123",
    categories: ["Auto body shop", "Collision repair"],
    services: ["Collision repair", "Paint repair"],
    serviceAreas: ["Austin"],
    socialLinks: [],
    bookingLinks: [],
    orderingLinks: [],
    pressLinks: []
  },
  formReferences: [],
  linkReferences: [],
  assetReferences: [],
  sampledInternalPages: [],
  pageSummaries: [],
  score: {
    overall: 72,
    max: 100,
    percent: 72,
    grade: "good",
    checks: []
  },
  findings: []
};

const visibleFactsSummary = summarizeCrawlHtml(
  `<html>
    <head>
      <title>Precision Auto Body | Austin Collision Repair</title>
      <script type="application/ld+json">{"@type":"AutoRepair","name":"Precision Auto Body","openingHours":["Mo-Fr 08:00-17:00"]}</script>
    </head>
    <body>
      <nav>
        <a href="/services/collision-repair">Collision repair</a>
        <a href="/services/paint-repair">Paint repair</a>
        <a href="/contact">Contact</a>
      </nav>
      <section><h2>Hours</h2><p>Monday-Friday 8:00 AM - 5:00 PM</p></section>
    </body>
  </html>`,
  "https://precision.example/services/collision-repair"
);
assert.ok(visibleFactsSummary.extractedFacts.services.includes("Collision Repair"), "crawler should extract service names from service links");
assert.ok(visibleFactsSummary.extractedFacts.services.includes("Paint Repair"), "crawler should extract multiple visible services");
assert.equal(visibleFactsSummary.extractedFacts.services.includes("Precision Auto Body"), false, "crawler should not treat the business name as a service");
assert.ok(visibleFactsSummary.extractedFacts.hours, "crawler should retain schema or visible hours");
const robotsPolicy = parseRobotsTxt(
  `User-agent: *
Disallow: /private
Allow: /private/service-hours

User-agent: OtherBot
Disallow: /`,
  "https://precision.example"
);
assert.equal(robotsPolicy.allowed("https://precision.example/services"), true, "crawler robots policy should allow unrelated public paths");
assert.equal(robotsPolicy.allowed("https://precision.example/private/estimate"), false, "crawler robots policy should block disallowed paths");
assert.equal(
  robotsPolicy.allowed("https://precision.example/private/service-hours"),
  true,
  "crawler robots policy should prefer the longest matching allow rule"
);

const bundle = createSiteFromInput({ crawl: autoBodyCrawl, url: autoBodyCrawl.url });
const draft = bundle.siteModel.versions[0];
assert.equal(bundle.businessProfile.vertical, "auto_body", "auto body terms should classify as auto_body");
assert.equal(draft.status, "draft", "initial generated version should be a draft");
assert.equal(draft.rendererVersion, "layout-v1", "generated drafts should use the layout-v1 renderer");
assert.equal(draft.designSchemaVersion, "design-v1", "generated drafts should use the design-v1 schema");
assert.ok(draft.designPlan, "generated drafts should persist a design plan");
assert.ok(draft.pages.every((page) => page.layoutSections.length > 0), "generated pages should persist layout sections");
assert.deepEqual(
  validateLayoutDocument(draft).filter((issue) => issue.repairMode === "fatal_schema" || issue.repairMode === "operator_blocked"),
  [],
  "generated layout-v1 document should pass blocking validation"
);
assert.equal(draft.generationQa?.readiness, "pending", "initial generated version should start pending generated QA");
assert.ok(bundle.presenceAssessment.normalizedBusinessFacts, "normalized facts should be stored");
assert.ok(bundle.presenceAssessment.businessFactGraph?.facts.some((fact) => fact.kind === "service"), "business fact graph should expose service facts");
assert.ok(bundle.presenceAssessment.businessFactGraph?.facts.some((fact) => fact.kind === "phone"), "business fact graph should expose contact facts");
assert.ok(bundle.presenceAssessment.generationPlanV2?.pages.some((page) => page.sections.length > 0), "generation plan v2 should map pages to catalog sections");
assert.equal(bundle.presenceAssessment.generationPlanV2?.verification.status, "passed", "generation plan v2 copy should start claim-safe");
assert.equal(bundle.presenceAssessment.generationPlanV2?.director.contractVersion, "site-director-v1", "generation plan v2 should include the Site Director contract");
assert.ok(
  bundle.presenceAssessment.generationPlanV2?.pages[0]?.sections[0]?.copyPolicy.forbiddenClaimCategories.includes("insurance"),
  "Site Director copy policy should explicitly forbid unsupported sensitive claim categories"
);
assert.deepEqual(
  bundle.presenceAssessment.generationPlanV2?.structuralRejections,
  [],
  "Site Director should not emit structural rejections for a clean generated plan"
);
assert.ok(bundle.presenceAssessment.generationBrief?.renderableFacts.length, "generation brief should expose renderable facts");
assert.equal(bundle.presenceAssessment.creativeBrief?.mockupPrompt.includes("Only express these concrete facts"), true);
assert.equal(
  bundle.presenceAssessment.generationCostEstimate?.minimums.generatedRenderQa,
  "required_before_ready",
  "generation cost policy should reserve generated-site render QA before readiness"
);
assert.equal(
  bundle.presenceAssessment.generationCostEstimate?.gates.deterministicVisualQa,
  "required",
  "deterministic visual QA should be mandatory for every generation"
);

const hoursBundle = createSiteFromInput({
  crawl: {
    ...autoBodyCrawl,
    extractedFacts: {
      ...autoBodyCrawl.extractedFacts,
      hours: {
        hours_1: "Monday-Friday 8:00 AM - 5:00 PM",
        hours_2: "Saturday: By appointment"
      }
    }
  },
  url: autoBodyCrawl.url
});
const hoursHtml = renderToStaticMarkup(
  React.createElement(SiteRenderer, {
    business: hoursBundle.businessProfile,
    site: hoursBundle.siteModel,
    extensions: hoursBundle.extensionModel,
    version: hoursBundle.siteModel.versions[0],
    tracking: false,
    formsEnabled: false
  })
);
assert.ok(hoursHtml.includes('data-site-chrome="header"'), "generated renderer should include production site header chrome");
assert.ok(hoursHtml.includes('data-site-chrome="footer"'), "generated renderer should include production site footer chrome");
assert.ok(hoursHtml.includes("Services") && hoursHtml.includes("Contact"), "generated header/footer should expose site navigation labels");
assert.ok(hoursHtml.includes("Monday-Friday 8:00 AM - 5:00 PM"), "generated renderer should expose extracted business hours");
assert.ok(hoursHtml.includes("Saturday") && hoursHtml.includes("By appointment"), "generated renderer should expose multiple extracted hour rows");
assert.equal(hoursHtml.includes("hours_1"), false, "generated renderer should not leak internal hour keys");

const heavyCrawlCost = planGenerationCost({
  sourceUrl: autoBodyCrawl.url,
  crawl: {
    ...autoBodyCrawl,
    pageSummaries: Array.from({ length: 60 }, (_, index) => crawlPageSummaryForTest(index))
  },
  plannedMockupImageCount: 3,
  sourceModelVisualQaRequested: true,
  generatedModelVisualQaRequested: true,
  includeGeneratedRenderQa: true
});
assert.equal(isMockupImageGenerationAllowed(heavyCrawlCost), false, "budget pressure should skip mockup image generation first");
assert.equal(
  isModelVisualQaAllowed(heavyCrawlCost, "generated_site"),
  true,
  "budget pressure should preserve final generated-site model visual QA before optional mockup images"
);
assert.equal(heavyCrawlCost.status, "within_budget", "cost policy should rebalance optional gates back inside budget when possible");

const renderedText = JSON.stringify(draft.pages);
assert.equal(
  /\bLocal area\b|\bCore service\b|\bLocal support\b|\bowner-approved\b|\bowner-truth\b|\bCredential details can be verified\b|\bVisual proof slot ready\b/.test(renderedText),
  false,
  "blocked placeholders should not render in generated model"
);
assert.equal(
  /\b(this page|service page|search engines?|local search intent|primary action|conversion path|conversion actions?|ready visitors|proof sections?|trust proof|help visitors)\b/i.test(renderedText),
  false,
  "generated customer-site copy should not expose internal planning language"
);
assert.equal(renderedText.includes("Catering and contact"), false, "restaurant sample form labels should not leak into non-restaurant generated sites");
assert.equal(renderedText.includes("Insurance Accepted"), false, "unverified vertical trust claims should not render as facts");
assert.equal(renderedText.includes("1625047509168-a7026f36de04"), true, "auto body hero should use repair/shop-relevant registry imagery");

const fixturePrompts = [
  "Build a website for North Loop Tacos, a restaurant in Austin. services: tacos, catering, takeout phone: 555-555-0100",
  "Build a website for Super-B Paint and Body, an auto body shop in Austin. services: collision repair, paint repair phone: 555-555-0101",
  "Build a website for Lumen Beauty Salon, a salon in Austin. services: hair color, cuts, styling phone: 555-555-0102",
  "Build a website for Rivera Law Group, a law firm in Austin. services: estate planning, business attorney phone: 555-555-0103",
  "Build a website for Bright Smile Dental, a dental clinic in Austin. services: cleanings, crowns, emergency dental phone: 555-555-0104",
  "Build a website for Atlas Home Services, an HVAC plumbing and electrical company in Austin. services: HVAC repair, plumbing, electrical phone: 555-555-0105",
  "Build a website for Greenline Landscaping, a landscaping and lawn care company in Austin. services: landscape design, lawn care phone: 555-555-0106",
  "Build a website for North Star Creative Studio, a photography and creative studio in Austin. services: brand photography, portraits phone: 555-555-0107"
];
const fixtureBundles = fixturePrompts.map((prompt) => createSiteFromInput({ prompt }));
const fixtureHeroPresets = new Set<string>();
const fixtureTypographyPacks = new Set<string>();
for (const fixture of fixtureBundles) {
  const version = fixture.siteModel.versions[0]!;
  const home = version.pages[0]!;
  fixtureTypographyPacks.add(version.designPlan.typographyPack);
  const heroSection = home.layoutSections.find((section) => section.kind === "hero");
  assert.ok(heroSection, `${fixture.businessProfile.vertical} fixture should have a hero layout section`);
  fixtureHeroPresets.add(heroSection!.preset);
  assert.ok(home.layoutSections.some((section) => section.kind === "services" || section.kind === "menu"), `${fixture.businessProfile.vertical} fixture should include services/menu`);
  assert.ok(home.layoutSections.some((section) => section.kind === "contact"), `${fixture.businessProfile.vertical} fixture should include contact`);
  const localSignalProof = home.layoutSections.find((section) => {
    const items = propsForLayoutSection(section).items;
    return section.kind === "proof" && Array.isArray(items) && items.every((item) => typeof item === "string");
  });
  if (localSignalProof) {
    assert.equal(sectionFromLayoutSection(localSignalProof).type, "trust_bar", `${fixture.businessProfile.vertical} local-signal proof should render as a trust bar`);
  }
  assert.equal(
    version.pages.some((page) => page.layoutSections.some((section) => section.kind === "team")),
    false,
    `${fixture.businessProfile.vertical} fixture should omit team sections when no team-member facts were extracted`
  );
  if (!fixture.businessProfile.reviewsSummary) {
    assert.equal(
      version.pages.some((page) =>
        page.layoutSections.some((section) =>
          objectArrayPropForTest(propsForLayoutSection(section).items).some((item) => typeof item.quote === "string")
        )
      ),
      false,
      `${fixture.businessProfile.vertical} fixture should omit testimonial quote sections when no review facts were extracted`
    );
  }
  assert.deepEqual(
    validateLayoutDocument(version).filter((issue) => issue.repairMode === "fatal_schema" || issue.repairMode === "operator_blocked"),
    [],
    `${fixture.businessProfile.vertical} fixture should pass layout validation`
  );
}
assert.ok(fixtureHeroPresets.size >= 4, "vertical fixtures should visibly vary hero presets");
assert.ok(fixtureTypographyPacks.size >= 3, "vertical fixtures should vary typography packs");

const invalidPresetVersion = structuredClone(draft);
invalidPresetVersion.pages[0]!.layoutSections[0]!.preset = "hero.not_registered" as never;
assert.ok(
  validateLayoutDocument(invalidPresetVersion).some((issue) => issue.id === "invalid_preset" && issue.repairMode === "fatal_schema"),
  "invalid presets should fail validation"
);

const arbitraryCodeVersion = structuredClone(draft);
arbitraryCodeVersion.pages[0]!.layoutSections[0]!.slots.copy![0]!.props.rawHtml = "<script>alert(1)</script>";
assert.ok(
  validateLayoutDocument(arbitraryCodeVersion).some((issue) => issue.id === "arbitrary_code_prop" && issue.repairMode === "fatal_schema"),
  "arbitrary code props should be impossible to validate"
);

const hostedFontVersion = structuredClone(draft);
hostedFontVersion.designPlan.hostedFontAssetId = "font_asset_123";
assert.ok(
  validateLayoutDocument(hostedFontVersion).some((issue) => issue.id.startsWith("design_plan_") && issue.repairMode === "operator_blocked"),
  "hosted font assets should be rejected in design-v1"
);

const missingCtaVersion = structuredClone(draft);
const missingCtaHero = missingCtaVersion.pages[0]!.layoutSections.find((section) => section.kind === "hero")!;
for (const component of Object.values(missingCtaHero.slots).flat()) delete component.props.primaryCta;
assert.ok(validateLayoutDocument(missingCtaVersion).some((issue) => issue.id === "primary_cta_missing"));
const layoutRepair = repairLayoutDocument(missingCtaVersion);
assert.equal(layoutRepair.applied, true, "deterministic layout repair should inject a missing CTA");
assert.equal(validateLayoutDocument(missingCtaVersion).some((issue) => issue.id === "primary_cta_missing"), false);
assert.equal(maxAiGeneratedSiteRepairRetries("normal_generation"), 1, "normal AI repair should cap at one retry");
assert.equal(maxAiGeneratedSiteRepairRetries("operator_premium_generation"), 2, "operator premium AI repair should cap at two retries");
assert.equal(shouldAttemptAiGeneratedSiteRepair({ attempts: 1, mode: "normal_generation" }), false, "normal AI repair should stop at the retry cap");
assert.equal(shouldAttemptAiGeneratedSiteRepair({ attempts: 1, mode: "operator_premium_generation" }), true, "operator premium AI repair should allow the second retry");

const coverage = verticalImageRegistryCoverage();
for (const vertical of [
  "restaurant",
  "auto_body",
  "beauty_salon",
  "med_spa",
  "law_firm",
  "dental",
  "home_services",
  "fitness",
  "real_estate",
  "landscaping",
  "veterinary",
  "creative_studio",
  "general_local"
]) {
  assert.ok(Number(coverage[vertical]) > 0, `${vertical} should have at least one registry image`);
}
for (const [vertical, recipe] of Object.entries(verticalRecipes)) {
  if (!recipe.defaultSections.includes("gallery")) continue;
  assert.ok(Number(coverage[vertical]) >= 3, `${vertical} should have enough vertical-specific images for gallery sections`);
}

const hashBefore = computeSiteModelHash(bundle, draft);
draft.generationQa = {
  readiness: "blocked",
  siteModelHash: hashBefore,
  blockers: [{ id: "example", title: "Example", detail: "Example" }],
  warnings: [],
  checkedAt: new Date().toISOString()
};
assert.equal(computeSiteModelHash(bundle, draft), hashBefore, "QA metadata writes should not change render hash");
const hero = draft.pages[0]?.layoutSections.find((section) => section.kind === "hero");
assert.ok(hero, "fixture should include hero");
applyPropsToLayoutSection(hero!, { heading: "A changed renderable heading" });
assert.notEqual(computeSiteModelHash(bundle, draft), hashBefore, "renderable changes should change hash");

const placeholderBundle = createSiteFromInput({ prompt: "Build a website for Super-B Automotive Repair services: Collision repair phone: 555-555-0199" });
const placeholderVersion = placeholderBundle.siteModel.versions[0];
applyPropsToLayoutSection(placeholderVersion.pages[0]!.layoutSections[0]!, { body: "Core service for Local area customers." });
const blockers = blockersFromSiteModel(placeholderBundle, placeholderVersion);
assert.ok(blockers.some((blocker) => blocker.id === "placeholder_visible"), "visible generic placeholders should block generated QA");
applyPropsToLayoutSection(placeholderVersion.pages[0]!.layoutSections[0]!, { body: "This page helps visitors find the primary action." });
assert.ok(
  blockersFromSiteModel(placeholderBundle, placeholderVersion).some((blocker) => blocker.id === "placeholder_visible"),
  "visible internal website-planning language should block generated QA"
);
applyPropsToLayoutSection(placeholderVersion.pages[0]!.layoutSections[0]!, { body: "Core service for Local area customers." });
const repair = applyDeterministicGeneratedSiteRepair({
  bundle: placeholderBundle,
  version: placeholderVersion,
  blockers
});
assert.equal(repair.applied, true, "owner-untouched draft should accept deterministic repair");
assert.equal(blockersFromSiteModel(placeholderBundle, placeholderVersion).some((blocker) => blocker.id === "placeholder_visible"), false);
assert.equal(
  JSON.stringify(placeholderVersion.pages.map((page) => page.layoutSections.map(propsForLayoutSection))).includes("Core service"),
  false,
  "deterministic repair should mutate layout slot props, not only legacy section projections"
);

const structuralBundle = structuredClone(bundle);
const structuralVersion = structuralBundle.siteModel.versions[0]!;
structuralVersion.pages[0]!.layoutSections.push({
  id: "section_team_hallucination",
  kind: "team",
  preset: "team.profile_grid",
  slots: {
    content: [
      {
        id: "component_team_hallucination",
        type: "team",
        props: {
          members: [{ name: "Invented team member", role: "Owner" }]
        }
      }
    ]
  },
  background: "default",
  width: "contained",
  spacing: "standard",
  mobileBehavior: "stack",
  visibility: "all"
});
structuralBundle.presenceAssessment.generationPlanV2 = createGenerationPlanV2({
  bundle: structuralBundle,
  version: structuralVersion,
  factGraph: structuralBundle.presenceAssessment.businessFactGraph!
});
assert.ok(
  structuralBundle.presenceAssessment.generationPlanV2.structuralRejections.some(
    (rejection) => rejection.sectionId === "section_team_hallucination" && rejection.action === "omit_section"
  ),
  "Site Director should record a structural rejection when a section requires missing facts"
);
assert.ok(
  blockersFromSiteModel(structuralBundle, structuralVersion).some((blocker) => blocker.id.startsWith("director_structural_")),
  "generated-site QA should block sections rejected by the Site Director contract"
);

const readinessBundle = createSiteFromInput({ prompt: "Build a website for Super-B Automotive Repair services: Collision repair phone: 555-555-0199" });
const readinessVersion = readinessBundle.siteModel.versions[0];
applyPropsToLayoutSection(readinessVersion.pages[0]!.layoutSections[0]!, { body: "Core service for Local area customers." });
const readiness = await runInitialGeneratedSiteReadiness({ bundle: readinessBundle });
assert.equal(readiness.repaired, true, "initial generated-site readiness should record deterministic repair when it mutates a draft");
assert.equal(readiness.qa.visualQa?.target, "generated_site", "generated-site readiness should run visual QA against the generated render");
assert.ok(
  readiness.qa.generationCostEstimate?.lineItems.some((item) => item.id === "generated_render_qa"),
  "generated-site readiness should attach final render-QA cost metadata"
);
assert.equal(
  readiness.qa.blockers.some((blocker) => blocker.id === "placeholder_visible" || blocker.id.startsWith("claim_placeholder_")),
  false,
  "initial generated-site readiness should repair deterministic copy blockers before persistence"
);
if (readiness.status === "ready") {
  assert.ok((readiness.qa.artifactRefs?.length ?? 0) >= 2, "generated-site QA should persist browser screenshot artifact refs when browser inspection is available");
} else {
  assert.ok(
    readiness.qa.blockers.some((blocker) => blocker.id === "render_browser_unavailable"),
    "blocked generated-site readiness should explain browser inspection unavailability"
  );
}

placeholderVersion.ownerTouched = true;
const skippedRepair = applyDeterministicGeneratedSiteRepair({
  bundle: placeholderBundle,
  version: placeholderVersion,
  blockers: [{ id: "generic_image", title: "Generic image", detail: "Generic image" }]
});
assert.equal(skippedRepair.applied, false, "owner-touched versions should not be auto-repaired");

const stored = createAndStoreSite({ crawl: autoBodyCrawl, url: autoBodyCrawl.url });
const storedDraft = stored.siteModel.versions.find((version) => version.status === "draft");
assert.ok(storedDraft, "stored generated site should have a draft version");
const token = createPreviewToken({ siteId: stored.businessProfile.siteId });
assert.equal(token?.versionId, storedDraft!.id, "preview token should bind to generated draft version");
assert.equal(getEffectiveGenerationQaReadiness(stored, storedDraft!), "pending", "new generated site should be publish-pending until generated QA runs");

console.log("Generator v1.1 verification passed.");

function objectArrayPropForTest(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function crawlPageSummaryForTest(index: number): CrawlAssessment["pageSummaries"][number] {
  return {
    url: `https://super-b-paintandbody.example/services/${index}`,
    source: "sampled_internal",
    title: `Service ${index}`,
    hasViewportMeta: true,
    hasLocalBusinessSchema: false,
    hasTelLink: true,
    formCount: 0,
    imageCount: 1,
    imagesWithoutAlt: 0,
    internalLinkCount: 0,
    externalLinkCount: 0,
    jsonLdTypes: [],
    extractedFacts: {
      categories: [],
      services: [],
      serviceAreas: [],
      socialLinks: [],
      bookingLinks: [],
      orderingLinks: [],
      pressLinks: []
    },
    formReferences: [],
    linkReferences: [],
    assetReferences: []
  };
}
