import "./load-env";

import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { scoreCrawlAssessment, summarizeCrawlHtml, type CrawlAssessment } from "../lib/crawler";
import { createSiteFromInput, type IntakeInput } from "../lib/intake";
import { blockersFromInspection, blockersFromSiteModel } from "../lib/generated-site-qa";
import { inspectGeneratedSiteBundleRender } from "../lib/generated-site-render-inspection";
import { validateGenerationPlanV2AgainstVersion } from "../lib/generation-plan-v2";
import { applySiteDirectorDecisionsToPlan } from "../lib/site-director";
import { registryAssetByUrl } from "../lib/image-registry";
import { propsForLayoutSection, sectionFromLayoutSection } from "../lib/layout-registry";
import { placeToPublicPresenceEnrichment } from "../lib/public-presence";
import { SiteRenderer } from "../lib/site-renderer";

type QualityFixture = {
  id: string;
  input: IntakeInput;
  expectedHeroAssetId?: string;
  forbiddenModelText?: string[];
  forbiddenRenderedText?: string[];
  requiredRenderedText?: string[];
};

const forbiddenRenderedText = [
  "Review menu context",
  "Photos help set expectations",
  "Share service details, timing, and contact preferences",
  "business can respond clearly",
  "Send the details, check availability",
  "Click-to-call ready",
  "Real appetite comes from real visuals",
  "makes ordering simple",
  "fits the practice",
  "when the stakes are high",
  "Show the work and make quotes easy",
  "Let the work lead, then make inquiry simple",
  "Repair paths for dents",
  "Visual context for the repair conversation",
  "These general visuals help frame",
  "customers should describe",
  "Use the agreed next step",
  "The site source points",
  "specific without assuming",
  "not a photo of this specific shop",
  "source-backed",
  "repair conversation",
  "estimate conversation",
  "Call-first",
  "listed repair service available",
  "listed service customers can ask",
  "Finished repair context",
  "Body-shop repair context",
  "Panel finish and body damage context",
  "Use the sourced service list as the starting point",
  "Use the listed coverage areas as the starting point",
  "profile details",
  "Open live profile",
  "Google profile",
  "Use this section",
  "details and next steps",
  "with a clear next step",
  "What customers can ask about",
  "Customer conversation",
  "timing and contact details",
  "Call or send a message with timing",
  "is listed for",
  "frame the first"
];

const fixtures: QualityFixture[] = [
  {
    id: "auto_body",
    requiredRenderedText: ["Contact request", "Message", "Best way to reach you"],
    input: {
      prompt:
        "Build a website for Super-B Paint and Body, an auto body shop in Austin. services: collision repair, paint repair, bumper repair phone: 555-555-0101"
    }
  },
  {
    id: "restaurant",
    expectedHeroAssetId: "restaurant_tacos",
    input: {
      prompt:
        "Build a website for North Loop Tacos, a restaurant in Austin. services: tacos, catering, takeout phone: 555-555-0102"
    }
  },
  {
    id: "law_firm",
    forbiddenModelText: ["Request a Quote", "Ready to request an estimate?"],
    requiredRenderedText: ["Contact request", "Message"],
    input: {
      prompt:
        "Build a website for Rivera Law Group, a law firm in Austin. services: estate planning, business attorney phone: 555-555-0103"
    }
  },
  {
    id: "beauty_salon",
    expectedHeroAssetId: "beauty_salon_hair_detail",
    forbiddenModelText: ["Request a Quote"],
    requiredRenderedText: ["Contact request", "Message"],
    input: {
      prompt:
        "Build a website for Lumen Beauty Salon, a salon in Austin. services: hair color, cuts, styling phone: 555-555-0104"
    }
  },
  {
    id: "home_services",
    requiredRenderedText: ["Contact request", "Message", "What you need"],
    input: {
      prompt:
        "Build a website for Atlas Home Services, an HVAC plumbing and electrical company in Austin. services: HVAC repair, plumbing, electrical phone: 555-555-0105"
    }
  },
  {
    id: "landscaping",
    expectedHeroAssetId: "landscaping_green_lawn",
    forbiddenModelText: ["Show the work and make quotes easy"],
    forbiddenRenderedText: ["Clear service details and direct contact options", "planning need", "business matter type"],
    requiredRenderedText: ["Lawn Care, Landscape Design, and Seasonal Cleanup."],
    input: {
      prompt:
        "Build a website for Greenline Landscapes, a landscaping company in Austin. services: lawn care, landscape design, seasonal cleanup phone: 555-555-0106"
    }
  },
  {
    id: "creative_studio",
    expectedHeroAssetId: "creative_studio_camera",
    forbiddenModelText: ["Let the work lead, then make inquiry simple"],
    forbiddenRenderedText: ["Clear service details and direct contact options"],
    requiredRenderedText: ["Portrait Photography and Commercial Shoots."],
    input: {
      prompt:
        "Build a website for Framehouse Studio, a photography and creative studio in Austin. services: portrait photography, commercial shoots, project inquiries phone: 555-555-0107"
    }
  },
  websiteImportFixture()
];

const results = [];

for (const fixture of fixtures) {
  const bundle = createSiteFromInput(fixture.input);
  const version = bundle.siteModel.versions[0];
  assert.ok(version, `${fixture.id} should produce a renderable version`);
  const factGraph = bundle.presenceAssessment.businessFactGraph;
  const plan = bundle.presenceAssessment.generationPlanV2;
  assert.ok(factGraph, `${fixture.id} should produce a business fact graph`);
  assert.ok(plan, `${fixture.id} should produce a Site Director plan`);
  const planIssues = validateGenerationPlanV2AgainstVersion({ plan, version, factGraph });
  assert.equal(
    planIssues.length,
    0,
    `${fixture.id} should keep the Site Director contract aligned with the rendered site: ${planIssues.map((issue) => issue.id).join(", ")}`
  );
  const directedPlan = applySiteDirectorDecisionsToPlan({
    plan,
    model: "test-site-director",
    summary: "Model-backed Site Director decisions are valid for every rendered section.",
    decisions: plan.pages.flatMap((page) =>
      page.sections.map((section, index) => ({
        pageId: page.id,
        sectionId: section.id,
        action: "keep" as const,
        priority: index + 1,
        rationale: `Keep ${section.catalogSection} because it is supported by its section contract.`,
        factIds: [...section.requiredFactIds, ...section.optionalFactIds].slice(0, 4),
        allowedClaimCategories: section.copyPolicy.allowedClaimCategories
          .filter((category) => !section.copyPolicy.forbiddenClaimCategories.includes(category))
          .slice(0, 4),
        headlineBrief: `Use sourced ${section.kind} content.`,
        bodyBrief: "Keep copy concrete, concise, and backed by the available fact ids.",
        riskNotes: []
      }))
    )
  });
  assert.equal(
    directedPlan.issues.length,
    0,
    `${fixture.id} should accept valid model-backed Site Director decisions: ${directedPlan.issues.map((issue) => issue.id).join(", ")}`
  );
  const directedPlanIssues = validateGenerationPlanV2AgainstVersion({
    plan: directedPlan.plan,
    version,
    factGraph
  });
  assert.equal(
    directedPlanIssues.length,
    0,
    `${fixture.id} should validate accepted model-backed Site Director plans: ${directedPlanIssues.map((issue) => issue.id).join(", ")}`
  );
  assert.equal(directedPlan.plan.source, "ai_site_director", `${fixture.id} should mark accepted Site Director plans as model-backed`);
  const invalidDirectorPlan = applySiteDirectorDecisionsToPlan({
    plan,
    model: "test-site-director",
    summary: "Invalid decision should be rejected before readiness.",
    decisions: plan.pages.flatMap((page) =>
      page.sections.map((section, index) => ({
        pageId: page.id,
        sectionId: section.id,
        action: "keep" as const,
        priority: index + 1,
        rationale: `Keep ${section.catalogSection}.`,
        factIds: section.id === plan.pages[0]?.sections[0]?.id ? ["fact_missing"] : [...section.requiredFactIds, ...section.optionalFactIds].slice(0, 2),
        allowedClaimCategories: section.copyPolicy.allowedClaimCategories
          .filter((category) => !section.copyPolicy.forbiddenClaimCategories.includes(category))
          .slice(0, 3),
        headlineBrief: `Use sourced ${section.kind} content.`,
        bodyBrief: "Keep copy source-grounded.",
        riskNotes: []
      }))
    )
  });
  assert.ok(invalidDirectorPlan.issues.length > 0, `${fixture.id} should reject Site Director decisions with unsupported fact ids`);
  assert.equal(invalidDirectorPlan.plan.directorRun?.status, "rejected", `${fixture.id} should preserve deterministic fallback when Site Director decisions are rejected`);
  const heroPlan = plan.pages[0]?.sections.find((section) => section.kind === "hero");
  assert.ok(heroPlan, `${fixture.id} should include a hero section plan`);
  assert.equal(
    heroPlan.copyPolicy.allowedClaimCategories.includes("reviews"),
    Boolean(bundle.businessProfile.reviewsSummary?.rating || bundle.businessProfile.reviewsSummary?.count),
    `${fixture.id} hero copy policy should only allow review claims when review facts exist`
  );
  assert.equal(
    heroPlan.copyPolicy.allowedClaimCategories.includes("hours"),
    heroPlan.requiredFactKinds.includes("hours") || heroPlan.optionalFactKinds.includes("hours"),
    `${fixture.id} hero copy policy should only allow hours claims when hours facts exist`
  );
  if (fixture.expectedHeroAssetId) {
    const hero = version.pages[0]?.layoutSections.find((section) => section.kind === "hero");
    const v2Hero = version.rendererVersion === "layout-v2" ? version.compiledPages[0]?.sections.find((section) => section.family.startsWith("hero.")) : undefined;
    const heroImageUrl = v2Hero ? (v2Hero.props as { mediaUrl?: unknown }).mediaUrl : hero ? propsForLayoutSection(hero).imageUrl : undefined;
    const heroAsset = registryAssetByUrl(typeof heroImageUrl === "string" ? heroImageUrl : undefined);
    assert.equal(
      heroAsset?.id,
      fixture.expectedHeroAssetId,
      `${fixture.id} should choose a hero image from the extracted service context`
    );
  }
  if (fixture.forbiddenModelText?.length) {
    const modelText = JSON.stringify(version.pages);
    for (const text of fixture.forbiddenModelText) {
      assert.equal(modelText.includes(text), false, `${fixture.id} should not render mismatched copy: ${text}`);
    }
  }
  if (bundle.businessProfile.vertical === "restaurant") {
    const homeSections = version.pages[0]?.layoutSections ?? [];
    const v2HomeSections = version.rendererVersion === "layout-v2" ? (version.compiledPages[0]?.sections ?? []) : [];
    const menuIndex = version.rendererVersion === "layout-v2"
      ? v2HomeSections.findIndex((section) => section.family === "menu.highlights")
      : homeSections.findIndex((section) => {
          const projected = sectionFromLayoutSection(section);
          return projected.type === "menu_deals" || (projected.type === "services" && propsForLayoutSection(section).eyebrow === "Menu and offers");
        });
    const ctaIndex = version.rendererVersion === "layout-v2"
      ? v2HomeSections.findIndex((section) => section.family === "cta.final_band")
      : homeSections.findIndex((section) => section.kind === "cta");
    assert.ok(menuIndex >= 0, `${fixture.id} should render menu content on the homepage`);
    assert.ok(ctaIndex < 0 || menuIndex < ctaIndex, `${fixture.id} should show menu content before repeated CTA bands`);
  }
  if (version.rendererVersion === "layout-v2") {
    const sections = version.compiledPages[0]?.sections ?? [];
    const heroSection = sections.find((section) => section.family.startsWith("hero."));
    const heroMediaUrl = typeof heroSection?.props.mediaUrl === "string" ? heroSection.props.mediaUrl : undefined;
    const mediaUrls = sections.flatMap((section) =>
      Array.isArray(section.props.items)
        ? section.props.items
            .map((item) => (item && typeof item === "object" && "url" in item && typeof item.url === "string" ? item.url : undefined))
            .filter((url): url is string => Boolean(url))
        : []
    );
    const mediaTitles = sections.flatMap((section) =>
      Array.isArray(section.props.items)
        ? section.props.items
            .map((item) => (item && typeof item === "object" && "title" in item && typeof item.title === "string" ? item.title : undefined))
            .filter((title): title is string => Boolean(title))
        : []
    );
    assert.equal(
      heroMediaUrl ? mediaUrls.includes(heroMediaUrl) : false,
      false,
      `${fixture.id} should not reuse the hero image in later gallery sections`
    );
    assert.equal(
      new Set(mediaUrls).size,
      mediaUrls.length,
      `${fixture.id} should not repeat the same media asset within gallery sections`
    );
    if (bundle.businessProfile.vertical === "auto_body") {
      assert.equal(sections.some((section) => section.id === "estimate_guidance"), false, `${fixture.id} should not render the weak estimate-prep pill panel`);
      const servicesSection = sections.find((section) => section.family === "services.matrix");
      const services = Array.isArray(servicesSection?.props.services) ? servicesSection.props.services : [];
      const proofSection = sections.find((section) => section.family === "proof.trust_band");
      const proofItems = Array.isArray(proofSection?.props.items) ? proofSection.props.items : [];
      assert.ok(services.length >= 3, `${fixture.id} should render a useful service set`);
      assert.equal(
        services.every((service) => Boolean(service && typeof service === "object" && "href" in service && typeof service.href === "string" && service.href)),
        true,
        `${fixture.id} homepage service cards should consistently link to service pages`
      );
      assert.ok(proofItems.length >= 2, `${fixture.id} should render more than one useful shop detail in the proof band`);
      assert.equal(
        mediaUrls.every((url) => url.startsWith("/generated-site-assets/auto-body/")),
        true,
        `${fixture.id} auto-body gallery media should use category-correct generated auto-body preview assets`
      );
      assert.equal(new Set(mediaTitles).size, mediaTitles.length, `${fixture.id} gallery captions should not repeat the same title`);
    }
    if (
      bundle.businessProfile.vertical !== "auto_body" &&
      bundle.businessProfile.vertical !== "restaurant" &&
      bundle.businessProfile.vertical !== "home_services"
    ) {
      assert.ok(sections.some((section) => section.family === "faq.local_questions"), `${fixture.id} should render a generic local FAQ section`);
      assert.equal(
        sections.some((section) => section.family === "services.matrix" && section.variant === "featured_service_board"),
        bundle.businessProfile.vertical !== "law_firm",
        `${fixture.id} should vary generic-local service layout by business archetype`
      );
    }
  }
  const renderedHtml = renderToStaticMarkup(
    React.createElement(SiteRenderer, {
      business: bundle.businessProfile,
      site: bundle.siteModel,
      extensions: bundle.extensionModel,
      version,
      tracking: false,
      formsEnabled: false
    })
  );
  if (version.rendererVersion === "layout-v2") {
    assert.equal(renderedHtml.includes("data-mark-long"), false, `${fixture.id} should not render a repeated wordmark as a fallback brand mark`);
    assert.equal(renderedHtml.includes("site-mobile-action-v2"), true, `${fixture.id} should render mobile conversion actions`);
    if (bundle.businessProfile.vertical === "auto_body") {
      assert.equal(renderedHtml.includes("site-proof-strip-v2"), false, `${fixture.id} should not clutter the hero with service chips`);
      assert.equal(renderedHtml.includes("1625047509168-a7026f36de04"), false, `${fixture.id} should not use generic under-hood mechanic imagery for body-shop pages`);
      assert.ok(renderedHtml.includes("View service"), `${fixture.id} should expose consistent service-page affordances`);
    }
  }
  for (const text of [...forbiddenRenderedText, ...(fixture.forbiddenRenderedText ?? [])]) {
    assert.equal(renderedHtml.includes(text), false, `${fixture.id} should not render templated copy: ${text}`);
  }
  if (fixture.requiredRenderedText?.length) {
    for (const text of fixture.requiredRenderedText) {
      assert.ok(renderedHtml.includes(text), `${fixture.id} should render sourced business text: ${text}`);
    }
  }

  const inspection = await inspectGeneratedSiteBundleRender({
    bundle,
    version,
    qaRunId: `quality_${fixture.id}`
  });
  const blockers = [...blockersFromInspection(inspection), ...blockersFromSiteModel(bundle, version)];
  const failingFindings = inspection.findings.filter((finding) => finding.severity === "fail");

  assert.equal(
    inspection.adapter,
    "playwright",
    `${fixture.id} should use Playwright for quality calibration: ${inspection.unavailableReason ?? "no fallback reason"}`
  );
  assert.equal(blockers.length, 0, `${fixture.id} should have no generated-site blockers: ${blockers.map((item) => item.id).join(", ")}`);
  assert.equal(failingFindings.length, 0, `${fixture.id} should have no failing render findings: ${failingFindings.map((item) => item.id).join(", ")}`);
  assert.equal(inspection.metrics.siteHeaderDetected, true, `${fixture.id} should render production header chrome`);
  assert.equal(inspection.metrics.siteFooterDetected, true, `${fixture.id} should render production footer chrome`);
  assert.equal(inspection.metrics.primaryHeroCtaDetected, true, `${fixture.id} should mark a primary hero CTA`);
  assert.equal(inspection.metrics.primaryHeroCtaAboveFold, true, `${fixture.id} should keep the primary hero CTA above the fold`);
  assert.equal(inspection.metrics.horizontalOverflowPx, 0, `${fixture.id} should not create horizontal overflow`);
  assert.equal(inspection.metrics.brokenImageCount, 0, `${fixture.id} should not render broken images`);
  assert.ok((inspection.metrics.bodyFontSizePx ?? 0) >= 16, `${fixture.id} body text should be at least 16px`);
  assert.ok((inspection.metrics.minReadableTextFontSizePx ?? 0) >= 14, `${fixture.id} readable text should stay at least 14px`);
  assert.ok((inspection.metrics.minTextContrastRatio ?? 0) >= 4.5, `${fixture.id} text contrast should meet WCAG AA for body text`);
  assert.ok((inspection.metrics.bodyTextChars ?? 0) >= 700, `${fixture.id} should render enough customer-facing copy`);
  assert.ok((inspection.metrics.ctaCount ?? 0) >= 3, `${fixture.id} should render multiple contact paths`);
  assert.ok((inspection.metrics.telLinkCount ?? 0) >= 2, `${fixture.id} should render click-to-call paths`);
  if (version.rendererVersion === "layout-v2") {
    assert.ok((inspection.metrics.imageCount ?? 0) >= 3, `${fixture.id} V2 pages should include enough visual depth to avoid hero-only output`);
  }
  assert.equal(inspection.screenshots.length, 3, `${fixture.id} should capture desktop, tablet, and mobile screenshots`);
  assert.ok(
    inspection.screenshots.every((screenshot) => (screenshot.bytes ?? 0) > 10_000),
    `${fixture.id} screenshots should be non-empty`
  );
  if (version.rendererVersion === "layout-v2" && bundle.businessProfile.vertical === "auto_body") {
    const servicePage = version.compiledPages.find((page) => page.slug.startsWith("services/"));
    assert.ok(servicePage, `${fixture.id} should compile at least one service landing page`);
    const serviceInspection = await inspectGeneratedSiteBundleRender({
      bundle,
      version,
      qaRunId: `quality_${fixture.id}_service_page`,
      pageSlug: servicePage.slug
    });
    const serviceFailures = serviceInspection.findings.filter((finding) => finding.severity === "fail");
    assert.equal(serviceFailures.length, 0, `${fixture.id} service page should have no failing render findings: ${serviceFailures.map((item) => item.id).join(", ")}`);
    assert.ok((serviceInspection.metrics.sectionCount ?? 0) >= 6, `${fixture.id} service page should have enough section depth`);
    assert.ok((serviceInspection.metrics.bodyTextChars ?? 0) >= 1_400, `${fixture.id} service page should render useful service-specific copy`);
    assert.ok((serviceInspection.metrics.imageCount ?? 0) >= 3, `${fixture.id} service page should include service-specific media`);
    assert.equal(serviceInspection.metrics.brokenImageCount, 0, `${fixture.id} service page should not render broken media`);
  }

  results.push({
    id: fixture.id,
    vertical: bundle.businessProfile.vertical,
    screenshots: inspection.screenshots.map((screenshot) => ({
      viewport: screenshot.viewport,
      bytes: screenshot.bytes,
      path: screenshot.path
    })),
    metrics: {
      bodyTextChars: inspection.metrics.bodyTextChars,
      ctaCount: inspection.metrics.ctaCount,
      telLinkCount: inspection.metrics.telLinkCount,
      imageCount: inspection.metrics.imageCount
    }
  });
}

verifyMismatchedPlacesCandidateIsNotMerged();
verifySchemaHoursAndOfferCatalogExtraction();
verifyAutoBodySourceHighlightsExtraction();

process.stdout.write(`${JSON.stringify({ ok: true, fixtures: results }, null, 2)}\n`);

function verifyMismatchedPlacesCandidateIsNotMerged() {
  const url = "https://northlooptacos.example/";
  const homepage = summarizeCrawlHtml(
    `<!doctype html>
      <html>
        <head>
          <title>North Loop Tacos | Austin Taco Restaurant</title>
          <meta name="description" content="North Loop Tacos serves breakfast tacos, catering, and takeout in Austin." />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <script type="application/ld+json">{
            "@type": "Restaurant",
            "name": "North Loop Tacos",
            "telephone": "+15125550120",
            "address": {
              "@type": "PostalAddress",
              "streetAddress": "1100 N Loop Blvd",
              "addressLocality": "Austin",
              "addressRegion": "TX",
              "postalCode": "78751",
              "addressCountry": "US"
            }
          }</script>
        </head>
        <body>
          <a href="/menu/breakfast-tacos">Breakfast tacos</a>
          <a href="/catering">Catering</a>
          <a href="tel:+15125550120">Call</a>
        </body>
      </html>`,
    url
  );
  const crawl = buildCrawlAssessment(url, homepage, homepage);
  const observedAt = "2026-06-01T00:00:00.000Z";
  const publicPresence = placeToPublicPresenceEnrichment(
    {
      id: "places/wrong-business",
      displayName: { text: "South Austin Pizza Palace" },
      formattedAddress: "900 Wrong Way, Austin, TX 78704, USA",
      addressComponents: [
        { longText: "900", types: ["street_number"] },
        { longText: "Wrong Way", types: ["route"] },
        { longText: "Austin", types: ["locality"] },
        { shortText: "TX", longText: "Texas", types: ["administrative_area_level_1"] },
        { longText: "78704", types: ["postal_code"] },
        { shortText: "US", longText: "United States", types: ["country"] }
      ],
      primaryTypeDisplayName: { text: "Pizza restaurant" },
      types: ["restaurant", "food", "point_of_interest"],
      rating: 4.9,
      userRatingCount: 999,
      websiteUri: "https://southaustinpizza.example/",
      googleMapsUri: "https://maps.google.com/?cid=wrong",
      nationalPhoneNumber: "(512) 555-9999",
      regularOpeningHours: {
        weekdayDescriptions: ["Monday: Open 24 hours"]
      }
    },
    { url, crawl },
    "North Loop Tacos Austin",
    observedAt
  );
  assert.deepEqual(publicPresence.facts, {}, "Mismatched Google Places candidates should not merge renderable business facts");
  assert.ok(
    publicPresence.notes.some((note) => /not merged/i.test(note)),
    "Mismatched Google Places candidates should explain that they were retained but not merged"
  );

  const bundle = createSiteFromInput({ url, crawl, publicPresence });
  assert.equal(bundle.businessProfile.name, "North Loop Tacos", "Rejected Places candidate should not override the crawled business name");
  assert.equal(bundle.businessProfile.phone, "+15125550120", "Rejected Places candidate should not override the crawled phone");
  assert.equal(bundle.businessProfile.reviewsSummary, undefined, "Rejected Places candidate should not add unrelated review facts");
  assert.equal(bundle.businessProfile.address?.street, "1100 N Loop Blvd", "Rejected Places candidate should not override the crawled address");
}

function verifySchemaHoursAndOfferCatalogExtraction() {
  const url = "https://greenline.example/";
  const summary = summarizeCrawlHtml(
    `<!doctype html>
      <html>
        <head>
          <title>Greenline Landscapes | Austin Landscaping</title>
          <meta name="description" content="Greenline Landscapes provides lawn care, landscape design, and seasonal cleanup in Austin." />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="icon" href="/favicon.png" />
          <script type="application/ld+json">{
            "@context": "https://schema.org",
            "@type": "LocalBusiness",
            "name": "Greenline Landscapes",
            "telephone": "+15125550106",
            "address": {
              "@type": "PostalAddress",
              "addressLocality": "Austin",
              "addressRegion": "TX",
              "addressCountry": "US"
            },
            "openingHoursSpecification": [{
              "@type": "OpeningHoursSpecification",
              "dayOfWeek": [
                "https://schema.org/Monday",
                "https://schema.org/Tuesday",
                "https://schema.org/Wednesday",
                "https://schema.org/Thursday",
                "https://schema.org/Friday"
              ],
              "opens": "08:00",
              "closes": "17:00"
            }],
            "hasOfferCatalog": {
              "@type": "OfferCatalog",
              "name": "Services",
              "itemListElement": [{
                "@type": "Offer",
                "itemOffered": { "@type": "Service", "name": "Lawn Care" }
              }, {
                "@type": "Offer",
                "itemOffered": { "@type": "Service", "name": "Landscape Design" }
              }, {
                "@type": "Offer",
                "itemOffered": { "@type": "Service", "name": "Seasonal Cleanup" }
              }]
            }
          }</script>
        </head>
        <body>
          <a href="tel:+15125550106">Call</a>
        </body>
      </html>`,
    url
  );
  assert.deepEqual(
    summary.extractedFacts.services.slice(0, 3),
    ["Lawn Care", "Landscape Design", "Seasonal Cleanup"],
    "Crawler should extract nested OfferCatalog service names from JSON-LD"
  );
  assert.deepEqual(
    summary.extractedFacts.hours,
    { hours_1: "Monday-Friday: 8:00 AM - 5:00 PM" },
    "Crawler should normalize openingHoursSpecification into renderable weekday hours"
  );
  assert.ok(
    summary.assetReferences.some((asset) => asset.kind === "logo" && asset.url === "https://greenline.example/favicon.png"),
    "Crawler should retain favicon/logo references as reference-only brand cues"
  );
  const crawl = buildCrawlAssessment(url, summary, summary);
  const bundle = createSiteFromInput({ url, crawl });
  const version = bundle.siteModel.versions[0];
  assert.ok(version, "Schema fixture should produce a generated version");
  const renderedHtml = renderToStaticMarkup(
    React.createElement(SiteRenderer, {
      business: bundle.businessProfile,
      site: bundle.siteModel,
      extensions: bundle.extensionModel,
      version,
      tracking: false,
      formsEnabled: false
    })
  );
  for (const text of ["Lawn Care", "Landscape Design", "Seasonal Cleanup", "Monday-Friday", "8:00 AM - 5:00 PM"]) {
    assert.ok(renderedHtml.includes(text), `Schema-derived facts should render on generated site: ${text}`);
  }
}

function websiteImportFixture(): QualityFixture {
  const url = "https://northlooptacos.example/";
  const homepage = summarizeCrawlHtml(
    `<!doctype html>
      <html>
        <head>
          <title>North Loop Tacos | Austin Taco Restaurant</title>
          <meta name="description" content="North Loop Tacos serves breakfast tacos, catering, and takeout in Austin with online ordering, pickup, and a direct phone line." />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="canonical" href="${url}" />
          <script type="application/ld+json">{
            "@type": "Restaurant",
            "name": "North Loop Tacos",
            "telephone": "+15125550120",
            "address": {
              "@type": "PostalAddress",
              "streetAddress": "1100 N Loop Blvd",
              "addressLocality": "Austin",
              "addressRegion": "TX",
              "postalCode": "78751",
              "addressCountry": "US"
            },
            "openingHoursSpecification": [
              {
                "@type": "OpeningHoursSpecification",
                "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday"],
                "opens": "08:00",
                "closes": "21:00"
              },
              {
                "@type": "OpeningHoursSpecification",
                "dayOfWeek": "Friday",
                "opens": "08:00",
                "closes": "22:00"
              }
            ],
            "servesCuisine": "Tacos"
          }</script>
        </head>
        <body>
          <nav>
            <a href="/menu/breakfast-tacos">Breakfast tacos</a>
            <a href="/catering">Catering</a>
            <a href="/takeout">Takeout</a>
            <a href="tel:+15125550120">Call</a>
          </nav>
          <a href="https://order.example/north-loop-tacos">Order online</a>
        </body>
      </html>`,
    url
  );
  const menu = summarizeCrawlHtml(
    `<!doctype html>
      <html>
        <head>
          <title>Breakfast Tacos | North Loop Tacos</title>
          <meta name="description" content="Breakfast tacos, catering trays, and takeout options for Austin guests." />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </head>
        <body>
          <a href="/menu/breakfast-tacos">Breakfast tacos</a>
          <a href="/menu/catering-trays">Catering trays</a>
          <a href="/takeout">Takeout</a>
          <a href="tel:+15125550120">Call</a>
        </body>
      </html>`,
    `${url}menu/breakfast-tacos`
  );
  const crawl = buildCrawlAssessment(url, homepage, menu);
  const observedAt = "2026-06-01T00:00:00.000Z";
  const publicPresence = placeToPublicPresenceEnrichment(
    {
      id: "places/north-loop-tacos",
      displayName: { text: "North Loop Tacos" },
      formattedAddress: "1100 N Loop Blvd, Austin, TX 78751, USA",
      addressComponents: [
        { longText: "1100", types: ["street_number"] },
        { longText: "N Loop Blvd", types: ["route"] },
        { longText: "Austin", types: ["locality"] },
        { shortText: "TX", longText: "Texas", types: ["administrative_area_level_1"] },
        { longText: "78751", types: ["postal_code"] },
        { shortText: "US", longText: "United States", types: ["country"] }
      ],
      location: { latitude: 30.315, longitude: -97.724 },
      primaryTypeDisplayName: { text: "Taco restaurant" },
      types: ["restaurant", "food", "point_of_interest"],
      rating: 4.7,
      userRatingCount: 218,
      websiteUri: url,
      googleMapsUri: "https://maps.google.com/?cid=12345",
      nationalPhoneNumber: "(512) 555-0120",
      regularOpeningHours: {
        weekdayDescriptions: [
          "Monday: 8:00 AM - 9:00 PM",
          "Tuesday: 8:00 AM - 9:00 PM",
          "Wednesday: 8:00 AM - 9:00 PM",
          "Thursday: 8:00 AM - 9:00 PM",
          "Friday: 8:00 AM - 10:00 PM",
          "Saturday: 9:00 AM - 10:00 PM",
          "Sunday: 9:00 AM - 3:00 PM"
        ]
      }
    },
    { url, crawl },
    "North Loop Tacos Austin",
    observedAt
  );

  return {
    id: "url_import_places",
    input: { url, crawl, publicPresence },
    expectedHeroAssetId: "restaurant_tacos",
    forbiddenModelText: ["Customer decision path", "Conversion standard", "Review summary detected"],
    forbiddenRenderedText: ["4.7 average rating", "218 reviews", "https://maps.google.com/?cid=12345"],
    requiredRenderedText: [
      "Breakfast Tacos",
      "Catering",
      "Takeout",
      "Monday",
      "8:00 AM - 9:00 PM",
      "1100 N Loop Blvd"
    ]
  };
}

function verifyAutoBodySourceHighlightsExtraction() {
  const url = "https://superb-source.example/";
  const homepage = summarizeCrawlHtml(
    `<!doctype html>
      <html>
        <head>
          <title>Super B Automotive Repair | Austin Auto Body</title>
          <meta name="description" content="Collision repair, paint and body, insurance claims, automotive glass, and hail damage repair in Austin." />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </head>
        <body>
          <h1>Super B Automotive Repair</h1>
          <p>We offer PDR (paintless dent repair) for smaller fender benders and hail repair.</p>
          <p>Now offering automotive glass services for windshields and windows alike.</p>
          <p>Ask about deductible support and rental car options when you call.</p>
          <a href="tel:+15125550107">Call</a>
        </body>
      </html>`,
    url
  );
  assert.deepEqual(
    (homepage.extractedFacts.serviceHighlights ?? []).slice(0, 3),
    [
      "PDR for smaller dents and hail repair",
      "Automotive glass for windshields and windows",
      "Ask about deductible and rental-car options"
    ],
    "Crawler should extract cautious source-backed auto-body highlights"
  );
  const crawl: CrawlAssessment = {
    url,
    fetched: true,
    status: 200,
    finalUrl: url,
    title: homepage.title,
    metaDescription: homepage.metaDescription,
    canonical: homepage.canonical,
    hasViewportMeta: homepage.hasViewportMeta,
    hasLocalBusinessSchema: homepage.hasLocalBusinessSchema,
    hasTelLink: homepage.hasTelLink,
    robotsFound: true,
    sitemapFound: true,
    formCount: homepage.formCount,
    imageCount: homepage.imageCount,
    imagesWithoutAlt: homepage.imagesWithoutAlt,
    internalLinkCount: homepage.internalLinkCount,
    externalLinkCount: homepage.externalLinkCount,
    jsonLdTypes: homepage.jsonLdTypes,
    extractedFacts: homepage.extractedFacts,
    formReferences: homepage.formReferences,
    linkReferences: homepage.linkReferences,
    assetReferences: homepage.assetReferences,
    sampledInternalPages: [],
    pageSummaries: [homepage],
    score: { overall: 0, max: 0, percent: 0, grade: "poor", checks: [] },
    findings: []
  };
  crawl.score = scoreCrawlAssessment(crawl);
  const bundle = createSiteFromInput({ url, crawl });
  assert.ok(
    bundle.businessProfile.serviceHighlights?.includes("PDR for smaller dents and hail repair"),
    "Intake should carry source highlights into the business profile"
  );
  const version = bundle.siteModel.versions[0];
  assert.ok(version, "Source-highlight fixture should produce a generated version");
  const renderedHtml = renderToStaticMarkup(
    React.createElement(SiteRenderer, {
      business: bundle.businessProfile,
      site: bundle.siteModel,
      extensions: bundle.extensionModel,
      version,
      tracking: false,
      formsEnabled: false
    })
  );
  assert.ok(
    renderedHtml.includes("PDR for smaller dents and hail repair"),
    "V2 auto-body proof details should use source-backed highlights when available"
  );
}

function buildCrawlAssessment(url: string, homepage: ReturnType<typeof summarizeCrawlHtml>, menu: ReturnType<typeof summarizeCrawlHtml>): CrawlAssessment {
  const services = Array.from(
    new Set([...homepage.extractedFacts.services, ...menu.extractedFacts.services, "Breakfast Tacos", "Catering", "Takeout"])
  );
  const categories = Array.from(new Set([...homepage.extractedFacts.categories, ...menu.extractedFacts.categories, "Restaurant", "Taco restaurant"]));
  const crawl: CrawlAssessment = {
    url,
    fetched: true,
    status: 200,
    finalUrl: url,
    title: homepage.title,
    metaDescription: homepage.metaDescription,
    canonical: homepage.canonical,
    hasViewportMeta: homepage.hasViewportMeta,
    hasLocalBusinessSchema: homepage.hasLocalBusinessSchema,
    hasTelLink: true,
    robotsFound: true,
    sitemapFound: true,
    formCount: homepage.formCount + menu.formCount,
    imageCount: homepage.imageCount + menu.imageCount,
    imagesWithoutAlt: homepage.imagesWithoutAlt + menu.imagesWithoutAlt,
    internalLinkCount: homepage.internalLinkCount + menu.internalLinkCount,
    externalLinkCount: homepage.externalLinkCount + menu.externalLinkCount,
    jsonLdTypes: Array.from(new Set([...homepage.jsonLdTypes, ...menu.jsonLdTypes])),
    extractedFacts: {
      name: homepage.extractedFacts.name ?? "North Loop Tacos",
      description: homepage.extractedFacts.description ?? menu.extractedFacts.description,
      phone: homepage.extractedFacts.phone ?? menu.extractedFacts.phone ?? "+15125550120",
      email: homepage.extractedFacts.email ?? menu.extractedFacts.email,
      address: homepage.extractedFacts.address ?? menu.extractedFacts.address,
      geo: homepage.extractedFacts.geo ?? menu.extractedFacts.geo,
      hours: homepage.extractedFacts.hours ?? menu.extractedFacts.hours,
      categories,
      services,
      serviceHighlights: Array.from(new Set([...(homepage.extractedFacts.serviceHighlights ?? []), ...(menu.extractedFacts.serviceHighlights ?? [])])),
      serviceAreas: Array.from(new Set([...homepage.extractedFacts.serviceAreas, ...menu.extractedFacts.serviceAreas, "Austin"])),
      socialLinks: Array.from(new Set([...homepage.extractedFacts.socialLinks, ...menu.extractedFacts.socialLinks])),
      bookingLinks: Array.from(new Set([...homepage.extractedFacts.bookingLinks, ...menu.extractedFacts.bookingLinks])),
      orderingLinks: Array.from(new Set([...homepage.extractedFacts.orderingLinks, ...menu.extractedFacts.orderingLinks, "https://order.example/north-loop-tacos"])),
      pressLinks: Array.from(new Set([...homepage.extractedFacts.pressLinks, ...menu.extractedFacts.pressLinks])),
      reviewsSummary: homepage.extractedFacts.reviewsSummary ?? menu.extractedFacts.reviewsSummary
    },
    formReferences: [],
    linkReferences: [...homepage.linkReferences, ...menu.linkReferences].slice(0, 40),
    assetReferences: [],
    sampledInternalPages: [menu.url],
    pageSummaries: [homepage, menu],
    score: { overall: 0, max: 0, percent: 0, grade: "poor", checks: [] },
    findings: []
  };
  return {
    ...crawl,
    score: scoreCrawlAssessment(crawl)
  };
}
