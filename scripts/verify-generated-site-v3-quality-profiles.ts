import assert from "node:assert/strict";
import { createSiteV3FromInput } from "../lib/intake";
import { compileGeneratedSiteV3Site } from "../lib/generated-site-v3-compiler";
import { inspectGeneratedSiteBundleRender, renderGeneratedSiteHtml } from "../lib/generated-site-render-inspection";
import { buildGeneratedSiteQaMetadata } from "../lib/generated-site-qa";
import {
  generatedSiteVerticalQualityProfilesV1,
  generatedSiteVerticalQualityProfileForBusinessV1,
  mediaSuitabilityForProfileV1,
  semanticDedupeServiceItemsForProfileV1
} from "../lib/generated-site-v3-quality-profiles";
import type {
  AssetAnalysisV1,
  AssetReference,
  BusinessProfile,
  RenderInspectionFinding,
  RenderInspectionResult,
  SiteBundle,
  Vertical
} from "../lib/models";
import { getVisualSectionV3, type StandardItemV3 } from "../lib/generated-site-v3-visual-controls";
import { mediaFloorSlotVerdictV1 } from "../lib/media-floor-v1";

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
assert.equal(defaultProfile.id, "general_local", "General-local businesses should use the locked general-local profile.");
assert.equal(autoBodyProfile.identity.mode, "expanded", "Auto-body profile should be widened for identity generation.");
for (const profile of generatedSiteVerticalQualityProfilesV1) {
  if (profile.id === "default_local_service" || profile.id === "auto_body") continue;
  assert.equal(profile.identity.mode, "locked", `${profile.id} should remain locked until its vertical gate widens the profile.`);
  assert.ok(profile.identity.fontPairings.length === 1, `${profile.id} locked font pool should be degenerate.`);
  assert.ok(profile.identity.headerModes.length === 1, `${profile.id} locked header pool should be degenerate.`);
}

async function verifyDefaultProfileRenderPath() {
  for (const fixture of defaultProfileFixtures) {
    const bundle = fixtureBundle(fixture);
    const { version } = compileGeneratedSiteV3Site({ bundle, createdAt: "2026-06-18T00:00:00.000Z" });
    bundle.siteModel.versions = [version];

    const profileDecision = version.compilerDecisions?.find((decision) => decision.kind === "quality_profile_assignment");
    assert.equal(profileDecision?.resolvedValue, fixture.vertical, `${fixture.id} should record its vertical profile assignment.`);
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

async function verifyAutoBodyServiceProblemRowsRenderPath() {
  const bundle = menciaLikeFixtureBundle();
  const { version } = compileGeneratedSiteV3Site({ bundle, createdAt: "2026-06-18T00:00:00.000Z" });
  bundle.siteModel.versions = [version];

  const serviceSection = version.pageComposition.pages
    .flatMap((page) => page.sections)
    .find((section) => {
      const visualSection = getVisualSectionV3(section.props);
      return visualSection?.templateId === "intro_grid" && (visualSection.anchorId === "services" || section.id.includes("service"));
    });
  assert.ok(serviceSection, "Mencia-like fixture should compile an intro_grid services section.");

  const visualSection = getVisualSectionV3(serviceSection.props);
  assert.ok(visualSection?.templateId === "intro_grid", "Mencia-like services section should be intro_grid.");
  serviceSection.id = "services";
  serviceSection.props = {
    ...serviceSection.props,
    visualSectionV3: {
      ...visualSection,
      anchorId: "services",
      options: {
        ...visualSection.options,
        cardTreatment: "service_cards",
        cardAction: "bottom_aligned_button",
        cardTone: "featured_first",
        gridPattern: "equal_grid",
        mediaAspect: "16x10",
        mediaCrop: "subject"
      },
      slots: {
        ...visualSection.slots,
        intro: {
          eyebrow: "Services",
          heading: "Dent, hail, paint, and collision repair in Austin.",
          body: "Mencia Auto Body & Paint handles the visible damage and the details around it: dents, hail marks, bumper hits, paint scuffs, and panels that need to line up cleanly again."
        },
        items: {
          ...visualSection.slots.items,
          items: menciaServiceItems()
        }
      }
    }
  };
  version.artDirection = {
    ...version.artDirection,
    sectionPresentation: {
      ...(version.artDirection.sectionPresentation ?? {}),
      services: "service_problem_rows"
    }
  };

  const html = await renderGeneratedSiteHtml(bundle, version);
  const attributes = renderedServiceSectionAttributes(html);
  assert.deepEqual(
    attributes,
    {
      dataSectionTemplate: "intro_grid",
      dataCardTreatment: "service_cards",
      dataCardAction: "bottom_aligned_button",
      dataCardTone: "featured_first",
      dataGridPattern: "equal_grid",
      dataMediaAspect: "16x10",
      dataMediaCrop: "subject",
      dataPresentation: "service_problem_rows"
    },
    `Mencia-like services fixture rendered unexpected attributes: ${JSON.stringify(attributes)}`
  );

  const inspection = await inspectGeneratedSiteBundleRender({
    bundle,
    version,
    qaRunId: "quality_profile_mencia_service_problem_rows",
    captureScreenshots: false,
    captureSectionScreenshots: false
  });
  assert.equal(
    inspection.adapter,
    "playwright",
    `Mencia-like service rows should run through Playwright render inspection: ${inspection.unavailableReason ?? "no fallback reason"}`
  );
  assertNoTopLevelRenderFailures(inspection, "mobile", ["render.section_media_overflow", "render.section_quality"]);
  assertNoSectionFailures(inspection, "mobile", ["render.section_heading_overflow", "render.section_cramped_text"]);
  assertNoTopLevelRenderFailures(inspection, "desktop", ["render.section_media_overflow", "render.section_quality"]);
  assertNoTopLevelRenderFailures(inspection, "tablet", ["render.section_media_overflow", "render.section_quality"]);
  assertNoSectionFailures(inspection, "desktop", ["render.section_heading_overflow", "render.section_cramped_text"]);
  assertNoSectionFailures(inspection, "tablet", ["render.section_heading_overflow", "render.section_cramped_text"]);

  const qa = buildGeneratedSiteQaMetadata({
    bundle,
    version,
    inspection,
    qaRunId: "quality_profile_mencia_service_problem_rows"
  });
  assertNoQaBlockers(qa.blockers.map((blocker) => blocker.id), ["mobile_section_media_overflow", "mobile_section_quality_failure"]);
}

function verifyAutoBodyServicePolicy() {
  const paintingBundle = createSiteV3FromInput({
    prompt:
      "Build a website for Blue Line Body Shop, an auto body shop in Austin. Services: Factory and Custom Auto Painting. Phone: 512-555-0199.",
    identity: { siteId: "site_auto_body_painting_ingestion" }
  });
  assert.ok(
    paintingBundle.businessProfile.services.some((service) => /custom auto painting/i.test(service)),
    "Auto-body intake must retain source-backed painting services instead of filtering the gerund form."
  );
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
  const dedupedCorpus = deduped.items.map((item) => `${item.title} ${item.body}`).join("\n").toLowerCase();
  for (const sourceTitle of sourceItems.filter((item) => !/free repair quote/i.test(item.title)).map((item) => item.title)) {
    assert.equal(dedupedCorpus.includes(sourceTitle.toLowerCase()), true, `Semantic grouping must retain the source-listed service name: ${sourceTitle}.`);
  }
  assert.doesNotMatch(
    dedupedCorpus,
    /\b(start with|share the affected|show the affected|call with)\b/,
    "Rendered service descriptions should explain the work instead of reading like intake instructions."
  );
  const autocraftLike = semanticDedupeServiceItemsForProfileV1({
    profile: autoBodyProfile,
    items: [
      { title: "Auto Body Repair", body: "Source-backed body repair." },
      { title: "Collision Repair and Accident Restoration", body: "Source-backed collision repair." },
      { title: "Scratch, Ding and Dent Repair", body: "Source-backed scratch and dent repair." },
      { title: "Paintless Dent and Hail Damage Repair", body: "Source-backed hail and dent repair." },
      { title: "Paintless Dent Repair", body: "Source-backed paintless dent repair." },
      { title: "Frame Straightening", body: "Source-backed frame repair." },
      { title: "Body Panel Replacement", body: "Source-backed panel replacement." }
    ]
  });
  assert.equal(autocraftLike.items.length, 3, "Specific scratch and hail groups should keep a broad auto-body catalog from collapsing into two generic cards.");
  assert.equal(
    autocraftLike.items.filter((item) => /paintless|hail/i.test(`${item.title} ${item.body}`)).length,
    1,
    "A combined paintless-dent-and-hail source service should merge with a duplicate PDR-only listing."
  );
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
    const proofVerdict = mediaFloorSlotVerdictV1(fixture.asset, business, "proof");
    if (fixture.expectedProofAllowed && fixture.asset.analysisV1?.warnings.some((warning) => warning === "text_overlay" || warning === "collage_or_composite")) {
      assert.equal(proofVerdict.allowed, true, `${fixture.id} should clear the proof floor.`);
      assert.equal(proofVerdict.treatment, "framed", `${fixture.id} should render through the framed proof treatment.`);
    }
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

function profileBusinessWithPhotos(photos: AssetReference[]): Pick<BusinessProfile, "photos" | "vertical"> {
  return { photos, vertical: "auto_body" };
}

function verifyAutoBodyFramedProofCompilesThroughExistingFigureTreatment() {
  const bundle = menciaLikeFixtureBundle();
  bundle.businessProfile.photos = [
    assetFixture("compiled_text_overlay_before_after", "Before and after repair reference with text overlay", "before_after", ["text_overlay"])
  ];
  const compiled = compileGeneratedSiteV3Site({ bundle, createdAt: "2026-07-09T00:00:00.000Z" });
  assert.equal(
    compiled.version.artDirection.controls?.figureTreatment,
    "framed_shadow",
    "Framed first-party proof media should force the existing framed_shadow figure treatment."
  );
  assert.ok(
    compiled.version.mediaDecisions.some((decision) => decision.source === "first_party" && decision.slotId.startsWith("home.proof.")),
    "Framed proof media should compile as first-party proof, not library or text fallback."
  );
}

function menciaLikeFixtureBundle(): SiteBundle {
  const prompt =
    "Build a website for Mencia Auto Body & Paint, an auto body shop in Austin offering collision repair, professional paint services, paintless dent repair, bumper repair, hail damage repair, and scratch repair. phone: (512) 551-9434. address: 819 Houston St, Austin, TX 78756.";
  const bundle = createSiteV3FromInput({ prompt, identity: { siteId: "site_mencia_service_rows_regression" } });
  const business: BusinessProfile = {
    ...bundle.businessProfile,
    id: "biz_mencia_service_rows_regression",
    siteId: "site_mencia_service_rows_regression",
    name: "Mencia Auto Body & Paint",
    vertical: "auto_body",
    categories: ["Auto body shop", "Collision repair"],
    description:
      "Mencia Auto Body & Paint is an Austin auto body shop handling collision damage, paint work, dents, hail marks, bumper repair, and repair estimates.",
    phone: "(512) 551-9434",
    email: "support@menciaautoshop.com",
    address: { street: "819 Houston St", city: "Austin", region: "TX", postalCode: "78756", country: "US" },
    hours: {
      monday: "8:00 AM - 6:00 PM",
      tuesday: "8:00 AM - 6:00 PM",
      wednesday: "8:00 AM - 6:00 PM",
      thursday: "8:00 AM - 6:00 PM",
      friday: "8:00 AM - 6:00 PM"
    },
    services: ["Impact and Panel Repair", "Auto Paint and Refinishing", "Scratch and Scuff Repair", "Paintless Dent Repair", "Hail Damage Repair"],
    serviceHighlights: ["Collision repair", "Auto paint", "Dent repair", "Hail repair", "Bumper repair"],
    serviceAreas: ["Austin"],
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
        id: "loc_mencia_service_rows_regression",
        businessId: business.id ?? "biz_mencia_service_rows_regression",
        label: "Shop",
        address: business.address,
        serviceAreas: ["Austin"],
        phone: business.phone,
        email: business.email,
        hours: business.hours,
        provenance: {},
        createdAt: "2026-06-18T00:00:00.000Z",
        updatedAt: "2026-06-18T00:00:00.000Z"
      }
    ],
    locationBindings: [{ locationId: "loc_mencia_service_rows_regression", role: "primary", orderIndex: 0 }]
  };
}

function menciaServiceItems(): StandardItemV3[] {
  const media = [
    "/generated-site-assets/auto-body/lift-bay-overview-v1.png",
    "/generated-site-assets/auto-body/paint-prep-sanding-block-v1.png",
    "/generated-site-assets/auto-body/panel-gap-inspection-v1.png",
    "/generated-site-assets/auto-body/windshield-replacement-v1.png",
    "/generated-site-assets/auto-body/before-after-body-panel-v2.png"
  ];
  return [
    {
      title: "Impact and Panel Repair",
      body: "Structural and exterior panel damage is checked for fit, alignment, nearby trim, and the repair scope before the estimate conversation.",
      mediaUrl: media[0],
      href: "#contact"
    },
    {
      title: "Auto Paint and Refinishing",
      body: "Scuffed or repaired panels are matched against adjacent finish, edges, and trim so the blend disappears in daylight.",
      mediaUrl: media[1],
      href: "#contact"
    },
    {
      title: "Scratch and Scuff Repair",
      body: "The shop separates surface scuffs from paint or panel damage so the recommendation fits the depth, age, and finish.",
      mediaUrl: media[2],
      href: "#contact"
    },
    {
      title: "Paintless Dent Repair",
      body: "Best for shallow dents with intact paint and clear panel access, on the original finish whenever the panel allows it.",
      mediaUrl: media[3],
      href: "#contact"
    },
    {
      title: "Hail Damage Repair",
      body: "Roof, hood, door, and trim dents are mapped together so hail repair is planned around the full vehicle, not one mark at a time.",
      mediaUrl: media[4],
      href: "#contact"
    }
  ];
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

function assertNoTopLevelRenderFailures(inspection: RenderInspectionResult, viewport: string, prefixes: string[]) {
  const failures = inspection.findings.filter(
    (finding) => finding.viewport === viewport && finding.severity === "fail" && prefixes.some((prefix) => finding.id.startsWith(prefix))
  );
  assert.equal(
    failures.length,
    0,
    `${viewport} render failures:\n${failures.map((finding) => `${finding.id}: ${finding.evidence}`).join("\n")}`
  );
}

function assertNoSectionFailures(inspection: RenderInspectionResult, viewport: string, ids: string[]) {
  const servicesSection = inspection.sectionInspections?.find(
    (section) => section.viewport === viewport && (section.sectionId === "services" || section.templateId === "intro_grid")
  );
  assert.ok(servicesSection, `Expected ${viewport} services section inspection.`);
  const failures = servicesSection.findings.filter((finding) => finding.severity === "fail" && ids.includes(finding.id));
  assert.equal(
    failures.length,
    0,
    `${viewport} services section failures:\n${failures.map((finding) => `${finding.id}: ${finding.evidence}`).join("\n")}`
  );
}

function assertNoQaBlockers(actualBlockerIds: string[], forbiddenBlockerIds: string[]) {
  const unexpected = actualBlockerIds.filter((id) => forbiddenBlockerIds.includes(id));
  assert.equal(unexpected.length, 0, `Unexpected QA blockers: ${unexpected.join(", ")} from ${actualBlockerIds.join(", ")}`);
}

function renderedServiceSectionAttributes(html: string) {
  const sectionTag =
    findOpeningTag(html, "section", (tag) => tag.includes('data-section-id="services"')) ??
    findOpeningTag(html, "section", (tag) => tag.includes('data-section-template="intro_grid"'));
  const listTag = findOpeningTag(html, "div", (tag) => tag.includes("site-visual-list-v3"));
  return {
    dataSectionTemplate: dataAttribute(sectionTag, "data-section-template"),
    dataCardTreatment: dataAttribute(sectionTag, "data-card-treatment"),
    dataCardAction: dataAttribute(sectionTag, "data-card-action"),
    dataCardTone: dataAttribute(sectionTag, "data-card-tone"),
    dataGridPattern: dataAttribute(sectionTag, "data-grid-pattern"),
    dataMediaAspect: dataAttribute(sectionTag, "data-media-aspect"),
    dataMediaCrop: dataAttribute(sectionTag, "data-media-crop"),
    dataPresentation: dataAttribute(listTag, "data-presentation")
  };
}

function findOpeningTag(html: string, tagName: string, predicate: (tag: string) => boolean) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>`, "g");
  for (const match of html.matchAll(pattern)) {
    const tag = match[0];
    if (predicate(tag)) return tag;
  }
  return undefined;
}

function dataAttribute(tag: string | undefined, name: string) {
  if (!tag) return undefined;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`${escaped}="([^"]*)"`));
  return match?.[1];
}

const labeledAssetFixtures: LabeledAssetFixture[] = [
  {
    id: "text_overlay_before_after_framed",
    expectedWarnings: ["text_overlay"],
    expectedProofAllowed: true,
    asset: assetFixture("text_overlay_before_after_framed", "Before and after repair reference with text overlay", "before_after", ["text_overlay"])
  },
  {
    id: "collage_composite_framed",
    expectedWarnings: ["collage_or_composite"],
    expectedProofAllowed: true,
    asset: assetFixture("collage_composite_framed", "Before and after repair collage", "before_after", ["collage_or_composite"])
  },
  {
    id: "mencia_text_overlay_before_after",
    expectedWarnings: ["text_overlay", "logo_like"],
    expectedProofAllowed: false,
    asset: assetFixture("mencia_text_overlay_before_after", "Before & after repairs with text overlays", "before_after", ["text_overlay", "logo_like", "awkward_empty_space"])
  },
  {
    id: "mencia_collage_composite",
    expectedWarnings: ["collage_or_composite", "logo_like"],
    expectedProofAllowed: false,
    asset: assetFixture("mencia_collage_composite", "Before and after collage", "before_after", ["collage_or_composite", "logo_like"])
  },
  {
    id: "logo_tile_screenshot",
    expectedWarnings: ["logo_like", "text_overlay"],
    expectedProofAllowed: false,
    asset: assetFixture("logo_tile_screenshot", "Logo tile graphic screenshot", "text_heavy_graphic", ["logo_like", "text_overlay"])
  },
  {
    id: "clean_panel_detail",
    expectedWarnings: [],
    expectedProofAllowed: true,
    asset: assetFixture("clean_panel_detail", "Clean panel repair detail", "repair_detail", [])
  },
  {
    id: "clean_shop_environment",
    expectedWarnings: [],
    expectedProofAllowed: false,
    asset: assetFixture("clean_shop_environment", "Shop environment without visible customer repair outcome", "interior", [])
  }
];

function assetFixture(
  id: string,
  alt: string,
  imageKind: AssetAnalysisV1["imageKind"],
  warnings: AssetAnalysisV1["warnings"]
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
      focalPoint: "center",
      subjectPlacement: "centered",
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
verifyAutoBodyFramedProofCompilesThroughExistingFigureTreatment();
verifyAutoBodyServicePolicy();
await verifyDefaultProfileRenderPath();
await verifyAutoBodyServiceProblemRowsRenderPath();

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      defaultProfileFixtures: defaultProfileFixtures.length,
      classifierFixtures: labeledAssetFixtures.length,
      serviceRowsRegression: "mencia_service_problem_rows",
      profileIds: generatedSiteVerticalQualityProfilesV1.map((profile) => profile.id)
    },
    null,
    2
  )}\n`
);
