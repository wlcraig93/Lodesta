import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import {
  cleanServiceName,
  hoursRecordFromEntries,
  isDynamicHoursStatus,
  normalizeBusinessHours,
  normalizeServiceList
} from "../lib/business-understanding-v2";
import { lintGeneratedCopyDeck } from "../lib/generated-copy-v2";
import { compileGeneratedSiteV3Site } from "../lib/generated-site-v3-compiler";
import { applyGeneratedSiteV3QualityRepair } from "../lib/generated-site-v3-quality-repair";
import { getVisualSectionV3, withVisualSectionV3 } from "../lib/generated-site-v3-visual-controls";
import {
  applyQualityGateV2,
  areServicesVerticalDefaults,
  detectGenericHeroHeading,
  detectInternalStateCopy,
  detectMalformedServiceTitle,
  evaluateGenerationQualityV2,
  findDuplicateTitles,
  qualityReadyThreshold
} from "../lib/generation-quality-v2";
import { createSiteV3FromInput, inferVertical } from "../lib/intake";
import { defaultServicesForVertical } from "../lib/recipes";
import { localRepository } from "../lib/repository";
import { generateSite } from "../lib/site-candidate-service";
import type { CrawlAssessment } from "../lib/crawler";
import type {
  BusinessUnderstandingV2,
  GeneratedCopyDeckV2,
  GenerationQaMetadata,
  GenerationQualityReport,
  SiteBundle,
  SiteVersionV3
} from "../lib/models";

function loadAustinTiremanCrawl(): CrawlAssessment {
  const fixturePath = path.join(process.cwd(), "fixtures", "generation-quality", "austin-tireman-crawl.json");
  return JSON.parse(readFileSync(fixturePath, "utf-8")) as CrawlAssessment;
}

function readyQa(): GenerationQaMetadata {
  return { readiness: "ready", blockers: [], warnings: [] };
}

function mockUnderstanding(): BusinessUnderstandingV2 {
  return {
    version: "business-understanding-v2",
    source: "openai",
    vertical: "auto_services",
    verticalConfidence: 0.93,
    detectedSubverticals: ["tire_shop"],
    cleanedServices: [
      { name: "10 Minute Flat Repair", price: "Starting at $25", sourceText: "10 Minute Flat Repair Starting At $25", confidence: 0.9 },
      { name: "New and used tires", sourceText: "Used Tires & Wheels", confidence: 0.85 },
      { name: "Tire rotation and balancing", sourceText: "tires and wheels", confidence: 0.7 },
      { name: "Delivery", sourceText: "Delivery", confidence: 0.6 }
    ],
    hours: [
      { label: "Monday – Friday", value: "8:00am – 5:30pm" },
      { label: "Saturday", value: "8:00am – 4:00pm" },
      { label: "Sunday", value: "Closed" }
    ],
    primaryConversionGoal: "call_first",
    urgentServiceSignals: ["flat tire repair"],
    factConfidence: [
      { field: "phone", confidence: 0.95, sourceBacked: true },
      { field: "services", confidence: 0.85, sourceBacked: true }
    ],
    notes: ["Tire shop with walk-in flat repair positioning."]
  };
}

function mockCopyDeck(): GeneratedCopyDeckV2 {
  return {
    version: "generated-copy-deck-v2",
    source: "openai",
    hero: {
      eyebrow: "Tire shop in Austin, TX",
      heading: "Flat repairs in about 10 minutes, most days while you wait.",
      body: "Austin Tireman handles flat repairs, new and used tires, and rotations on Manchaca Rd. Pull in or call for a quick answer on price and timing."
    },
    servicesIntro: {
      heading: "Tires and tire service, priced before the work starts.",
      body: "From a $25 flat repair to a full set of tires, you get the price up front and most jobs are done while you wait."
    },
    serviceItems: [
      { title: "10 Minute Flat Repair", body: "Punctures patched fast, starting at $25, when the tire is repairable." },
      { title: "New and used tires", body: "Tires matched to your vehicle and budget, mounted and balanced on site." },
      { title: "Tire rotation and balancing", body: "Even wear and a smoother ride with a quick tread and pressure check." }
    ],
    processIntro: {
      heading: "From pulling in to driving out.",
      body: "Most tire visits follow the same quick path, with the price confirmed before any work starts."
    },
    processSteps: [
      { title: "Pull in or call ahead", body: "Walk-ins work for most tire issues; a call confirms your tire size is in stock." },
      { title: "Get a quick look", body: "The shop checks the tire and tells you whether it can be repaired or needs replacement." },
      { title: "Approve the price", body: "You get the number before any work starts, including mounting and balancing." }
    ],
    faqs: [
      { question: "Can my flat be repaired instead of replaced?", answer: "If the puncture is in the tread and the sidewall is intact, it can usually be patched after a quick look." },
      { question: "Do I need an appointment?", answer: "No. Walk-ins are the normal path for flats and swaps; calling ahead confirms stock for specific sizes." },
      { question: "How long does a flat repair take?", answer: "Most flat repairs are done in about 10 minutes once the vehicle is in the bay." },
      { question: "Do you sell used tires?", answer: "Yes. Used tires are inspected and matched to your vehicle and budget alongside new options." }
    ],
    locationIntro: {
      heading: "On Manchaca Rd in South Austin.",
      body: "Easy to reach from South Austin with parking out front; hours and directions below."
    },
    splitMedia: {
      heading: "Most tire problems are solved in one visit.",
      body: "We check the tire, give you the price, and handle the repair or swap on the spot. Most flats are back on the road in about ten minutes."
    },
    gallery: {
      heading: "The work, up close.",
      body: "Flat repairs, used tire swaps, and balancing in our Manchaca Rd bays."
    },
    voiceProfile: { pov: "first_plural" },
    contactIntro: {
      heading: "Call for a price or just pull in.",
      body: "A quick call confirms stock and timing for your tire size; walk-ins are welcome for flats."
    },
    seo: {
      title: "Austin Tireman | Tire Shop & Flat Repair in Austin, TX",
      description: "Flat repairs from $25, new and used tires, and rotations on Manchaca Rd in Austin. Walk-ins welcome, most jobs done while you wait."
    },
    groundingNotes: [
      "Flat repair price comes from the extracted service '10 Minute Flat Repair Starting At $25'.",
      "Address and hours come from the crawled business facts."
    ]
  };
}

async function main() {
  // --- unit: service-title cleanup ---
  assert.deepEqual(cleanServiceName("10 Minute Flat Repair Starting At $25"), {
    name: "10 Minute Flat Repair",
    price: "Starting at $25"
  });
  assert.equal(cleanServiceName("10 Minute Flat Repair 15 2")?.name, "10 Minute Flat Repair");
  assert.equal(cleanServiceName("12 34"), undefined);
  assert.equal(cleanServiceName("  "), undefined);
  assert.equal(cleanServiceName("BRAKE SERVICE")?.name, "Brake Service");
  const cleanedList = normalizeServiceList(["10 Minute Flat Repair Starting At $25", "10 Minute Flat Repair 15 2", "Delivery"]);
  assert.deepEqual(cleanedList.map((service) => service.name), ["10 Minute Flat Repair", "Delivery"]);
  assert.equal(cleanedList[0].price, "Starting at $25");

  // --- unit: hours normalization drops dynamic status strings ---
  assert.equal(isDynamicHoursStatus("We're currently closed. We're open again on Tuesday (June 9, 2026) from 8:00 am to 5:30 pm"), true);
  assert.equal(isDynamicHoursStatus("Monday – Friday 8:00am – 5:30pm"), false);
  const hours = normalizeBusinessHours({
    hours_1: "Monday – Friday 8:00am – 5:30pm",
    hours_2: "Saturday – 8:00am – 4:00pm",
    hours_3: "CLOSED on Sunday",
    hours_4: "We're currently closed. We're open again on Tuesday (June 9, 2026) from 8:00 am to 5:30 pm"
  });
  assert.deepEqual(hours, [
    { label: "Monday – Friday", value: "8:00am – 5:30pm" },
    { label: "Saturday", value: "8:00am – 4:00pm" },
    { label: "Sunday", value: "Closed" }
  ]);
  assert.deepEqual(hoursRecordFromEntries(hours), {
    "Monday – Friday": "8:00am – 5:30pm",
    Saturday: "8:00am – 4:00pm",
    Sunday: "Closed"
  });

  // --- unit: deterministic vertical fallback classifies the tire shop ---
  const crawl = loadAustinTiremanCrawl();
  assert.equal(inferVertical({ url: crawl.url, crawl }), "auto_services");
  assert.equal(inferVertical({ prompt: "collision and dent repair shop in Dallas" }), "auto_body");
  assert.equal(inferVertical({ prompt: "neighborhood coffee shop" }), "general_local");

  // --- unit: quality detectors ---
  assert.equal(detectGenericHeroHeading("Start with Austin Tireman."), true);
  assert.equal(detectGenericHeroHeading("A direct way to work with Austin Tireman."), true);
  assert.equal(detectGenericHeroHeading("Flat repairs in about 10 minutes."), false);
  assert.equal(detectMalformedServiceTitle("10 Minute Flat Repair 15 2"), true);
  assert.equal(detectMalformedServiceTitle("10 Minute Flat Repair Starting At $25"), true);
  assert.equal(detectMalformedServiceTitle("New and used tires"), false);
  assert.ok(detectInternalStateCopy("Austin, TX general local"));
  assert.ok(detectInternalStateCopy("Hours_4: We're currently closed."));
  assert.equal(detectInternalStateCopy("Tire shop in Austin, TX"), undefined);
  assert.deepEqual(findDuplicateTitles(["Share the situation", "Confirm the fit", "Share the situation"]), ["Share the situation"]);

  // --- unit: copy deck lint ---
  assert.deepEqual(lintGeneratedCopyDeck(mockCopyDeck()), []);
  const badDeck = mockCopyDeck();
  badDeck.hero.eyebrow = "Austin, TX general local";
  badDeck.faqs[1] = { ...badDeck.faqs[0] };
  const badDeckViolations = lintGeneratedCopyDeck(badDeck);
  assert.ok(badDeckViolations.some((violation) => violation.includes("vertical slug")), `expected slug violation, got: ${badDeckViolations.join(" | ")}`);
  assert.ok(badDeckViolations.some((violation) => violation.includes("duplicate questions")));

  // --- regression: Austin Tireman weak path (no LLM, no usable media) ---
  const weakBundle = createSiteV3FromInput({ url: crawl.url, crawl, identity: { siteId: "site_austin_tireman_test" } });
  assert.equal(weakBundle.businessProfile.vertical, "auto_services", "tire shop must not classify as general_local");
  assert.ok(weakBundle.businessProfile.services.includes("10 Minute Flat Repair"));
  assert.ok(!weakBundle.businessProfile.services.includes("10 Minute Flat Repair 15 2"), "mangled scrape fragments must not survive");
  assert.ok(weakBundle.businessProfile.serviceHighlights?.some((highlight) => highlight.includes("Starting at $25")), "price evidence must move to highlights");
  const weakHours = weakBundle.businessProfile.hours ?? {};
  assert.ok(!Object.keys(weakHours).some((key) => /^hours?_\d/i.test(key)), "raw hours keys must not survive");
  assert.ok(!Object.values(weakHours).some((value) => isDynamicHoursStatus(value)), "dynamic status strings must not survive");

  const weakCompile = compileGeneratedSiteV3Site({ bundle: weakBundle });
  assert.equal(weakCompile.compositionReport.selectedRecipe, "auto_services_v1");
  const weakJson = JSON.stringify(weakCompile.version.pageComposition);
  assert.ok(!/general[ _]local/i.test(weakJson), "internal vertical slug must not render");
  assert.ok(!/hours?_\d/i.test(weakJson), "raw hours labels must not render");
  assert.ok(!/currently closed/i.test(weakJson), "stale status strings must not render");
  assert.ok(!/"Start with /.test(weakJson), "template filler hero must not render for a classified vertical");
  const weakHome = weakCompile.version.pageComposition.pages[0];
  for (const section of weakHome.sections) {
    const visual = getVisualSectionV3(section.props);
    if (!visual) continue;
    const slots = visual.slots as Record<string, unknown>;
    const items = slots.items as { items?: Array<{ title?: string; question?: string }> } | undefined;
    const titles = (items?.items ?? []).map((item) => item.title ?? item.question ?? "");
    assert.deepEqual(findDuplicateTitles(titles.filter(Boolean)), [], `section ${section.id} must not repeat items`);
  }

  const weakReport = evaluateGenerationQualityV2({ bundle: weakBundle, version: weakCompile.version });
  assert.ok(
    weakCompile.version.mediaDecisions.some(
      (decision) =>
        (decision.rightsStatus === "approved" || decision.rightsStatus === "preclaim_safe") &&
        decision.mayImplyRealBusinessWork === false
    ),
    "visual-trade fixture must either block as text-only or carry rights-safe media that does not imply real business work"
  );
  const weakGated = applyQualityGateV2(readyQa(), weakReport);
  if (weakReport.findings.some((finding) => finding.id === "media_plan_missing_visual_trade" && finding.severity === "blocking")) {
    assert.equal(weakGated.readiness, "blocked", "text-only visual-trade candidate must persist as blocked");
    assert.ok(weakGated.blockers.some((blocker) => blocker.category === "quality_failed"));
  }
  assert.equal(weakGated.qualityReport?.version, "generation-quality-v2");

  // --- regression: legacy-style weak output (the original Austin Tireman failure mode) scores below 60 ---
  const legacyVersion = structuredClone(weakCompile.version) as SiteVersionV3;
  const legacyHome = legacyVersion.pageComposition.pages[0];
  for (const section of legacyHome.sections) {
    const visual = getVisualSectionV3(section.props);
    if (!visual) continue;
    const next = structuredClone(visual);
    const slots = next.slots as Record<string, unknown>;
    if (section.id === "hero") {
      (slots.copy as Record<string, unknown>).heading = "Start with Austin Tireman.";
      (slots.copy as Record<string, unknown>).eyebrow = "Austin, TX general local";
      (slots.copy as Record<string, unknown>).body = "10 Minute Flat Repair Starting At $25, 10 Minute Flat Repair 15 2, Delivery from Austin Tireman in Austin, TX.";
      slots.facts = { items: [{ label: "Services", value: "3" }, { label: "Start", value: "Call directly" }, { label: "Phone", value: "(512) 447-8473" }] };
    }
    if (section.id === "services") {
      slots.items = {
        items: [
          { title: "10 Minute Flat Repair Starting At $25", body: "x", meta: "01" },
          { title: "10 Minute Flat Repair 15 2", body: "x", meta: "02" },
          { title: "Delivery", body: "x", meta: "03" }
        ]
      };
    }
    if (section.id === "process") {
      slots.items = {
        items: [
          { title: "Share the situation", body: "x", meta: "01" },
          { title: "Confirm the fit", body: "x", meta: "02" },
          { title: "Plan the visit", body: "x", meta: "03" },
          { title: "Share the situation", body: "x", meta: "04" }
        ]
      };
    }
    section.props = withVisualSectionV3({ ...section.props }, next);
  }
  const legacyReport = evaluateGenerationQualityV2({ bundle: weakBundle, version: legacyVersion });
  assert.ok(legacyReport.overallScore < 60, `legacy-style output must score below 60, got ${legacyReport.overallScore}`);
  assert.ok(legacyReport.findings.some((finding) => finding.id === "hero_heading_generic"));
  assert.ok(legacyReport.findings.some((finding) => finding.id === "service_titles_malformed"));
  assert.ok(legacyReport.findings.some((finding) => finding.id === "duplicate_items_process"));
  assert.ok(legacyReport.findings.some((finding) => finding.id === "internal_state_visible"));
  assert.ok(legacyReport.findings.some((finding) => finding.id === "filler_facts_visible"));
  const legacyGated = applyQualityGateV2(readyQa(), legacyReport);
  assert.equal(legacyGated.readiness, "blocked");

  // --- repair: mechanical fixes resolve duplicates, filler facts, and internal eyebrows ---
  const repair = applyGeneratedSiteV3QualityRepair({ bundle: weakBundle, version: legacyVersion, report: legacyReport });
  assert.equal(repair.applied, true);
  const repairedReport = evaluateGenerationQualityV2({ bundle: weakBundle, version: legacyVersion });
  assert.ok(!repairedReport.findings.some((finding) => finding.id === "duplicate_items_process"), "repair must dedupe process items");
  assert.ok(!repairedReport.findings.some((finding) => finding.id === "filler_facts_visible"), "repair must remove filler facts");

  // --- good path: understanding + copy deck + rights-safe media reaches ready ---
  const goodBundle = createSiteV3FromInput({
    url: crawl.url,
    crawl,
    identity: { siteId: "site_austin_tireman_good" },
    understanding: mockUnderstanding()
  });
  assert.equal(goodBundle.businessProfile.vertical, "auto_services");
  goodBundle.presenceAssessment.generatedCopyDeck = mockCopyDeck();
  goodBundle.businessProfile.photos = [1, 2, 3, 4].map((index) => ({
    id: `asset_safe_${index}`,
    url: `https://assets.lodesta.example/tire-shop-${index}.jpg`,
    alt: `Tire service bay photo ${index}`,
    source: "licensed" as const,
    rightsStatus: "preclaim_safe" as const
  }));
  const goodCompile = compileGeneratedSiteV3Site({ bundle: goodBundle });
  assert.equal(goodCompile.compositionReport.selectedRecipe, "auto_services_v1");
  assert.ok(goodCompile.version.mediaDecisions.every((decision) => decision.source !== "text_layout_fallback"));
  const goodJson = JSON.stringify(goodCompile.version.pageComposition);
  assert.ok(goodJson.includes("Flat repairs in about 10 minutes"), "copy deck hero must render");
  const goodReport = evaluateGenerationQualityV2({ bundle: goodBundle, version: goodCompile.version });
  assert.deepEqual(
    goodReport.findings.filter((finding) => finding.severity === "blocking"),
    [],
    `good candidate must have no blocking findings: ${JSON.stringify(goodReport.findings)}`
  );
  assert.ok(
    goodReport.overallScore >= qualityReadyThreshold,
    `good candidate must clear the ready threshold, got ${goodReport.overallScore} (${JSON.stringify(goodReport.rubric)})`
  );
  const goodGated = applyQualityGateV2(readyQa(), goodReport);
  assert.equal(goodGated.readiness, "ready", "quality-passing candidate must stay ready");

  // --- gate: operator-review band (60-74) blocks with needs_operator_review ---
  const midReport: GenerationQualityReport = { ...goodReport, overallScore: 68, findings: [] };
  const midGated = applyQualityGateV2(readyQa(), midReport);
  assert.equal(midGated.readiness, "blocked");
  assert.ok(midGated.blockers.some((blocker) => blocker.id === "quality_needs_operator_review" && blocker.category === "needs_operator_review"));

  // --- gate: CTA mismatch for a phone-first business blocks ---
  const ctaVersion = structuredClone(goodCompile.version) as SiteVersionV3;
  const ctaHero = ctaVersion.pageComposition.pages[0].sections.find((section) => section.id === "hero");
  assert.ok(ctaHero);
  const ctaVisual = structuredClone(getVisualSectionV3(ctaHero.props));
  assert.ok(ctaVisual);
  ((ctaVisual.slots as Record<string, unknown>).copy as Record<string, unknown>).actions = [
    { label: "Send details", href: "#contact", style: "primary" }
  ];
  ctaHero.props = withVisualSectionV3({ ...ctaHero.props }, ctaVisual);
  const ctaReport = evaluateGenerationQualityV2({ bundle: goodBundle, version: ctaVersion });
  assert.ok(ctaReport.findings.some((finding) => finding.id === "cta_not_call_first" && finding.severity === "blocking"));

  // --- gate: unresolved general_local service business blocks readiness ---
  const generalBundle: SiteBundle = structuredClone(weakBundle);
  generalBundle.businessProfile.vertical = "general_local";
  generalBundle.presenceAssessment.businessUnderstanding = undefined;
  const generalCompile = compileGeneratedSiteV3Site({ bundle: generalBundle });
  const generalReport = evaluateGenerationQualityV2({ bundle: generalBundle, version: generalCompile.version });
  assert.ok(generalReport.findings.some((finding) => finding.id === "vertical_unresolved_service_business" && finding.severity === "blocking"));

  // --- P1 regression: vertical-default services are not source-backed grounding ---
  assert.equal(areServicesVerticalDefaults(defaultServicesForVertical("auto_body"), "auto_body"), true);
  assert.equal(areServicesVerticalDefaults(["10 Minute Flat Repair", "Delivery"], "auto_services"), false);
  const defaultServicesBundle = createSiteV3FromInput({
    prompt: "Create a website for Contract Collision, an auto body shop in Austin. Phone: (512) 555-0100. Address: 100 Test Road, Austin, TX 78702.",
    identity: { siteId: "site_default_services_test" }
  });
  assert.equal(defaultServicesBundle.businessProfile.vertical, "auto_body");
  assert.deepEqual(defaultServicesBundle.businessProfile.services, defaultServicesForVertical("auto_body"), "prompt without services must fall back to defaults");
  const defaultServicesCompile = compileGeneratedSiteV3Site({ bundle: defaultServicesBundle });
  const defaultServicesReport = evaluateGenerationQualityV2({ bundle: defaultServicesBundle, version: defaultServicesCompile.version });
  assert.ok(
    defaultServicesReport.findings.some((finding) => finding.id === "services_not_source_backed" && finding.severity === "blocking"),
    "default services on a non-generic vertical must produce a blocking finding"
  );
  assert.equal(applyQualityGateV2(readyQa(), defaultServicesReport).readiness, "blocked", "default-services candidate must not reach ready");
  assert.ok(
    !goodReport.findings.some((finding) => finding.id === "services_not_source_backed"),
    "source-backed services must not trigger the default-services finding"
  );

  // --- P2 regression: band blockers attach even when QA is already blocked ---
  const alreadyBlockedQa: GenerationQaMetadata = {
    readiness: "blocked",
    blockers: [{ id: "render_browser_unavailable", title: "x", detail: "x" }],
    warnings: []
  };
  const bandOnBlocked = applyQualityGateV2(alreadyBlockedQa, { ...goodReport, overallScore: 68, findings: [] });
  assert.equal(bandOnBlocked.readiness, "blocked");
  assert.ok(
    bandOnBlocked.blockers.some((blocker) => blocker.id === "quality_needs_operator_review" && blocker.category === "needs_operator_review"),
    "operator-review band blocker must attach to already-blocked candidates"
  );
  const failOnBlocked = applyQualityGateV2(alreadyBlockedQa, { ...goodReport, overallScore: 40, findings: [] });
  assert.ok(
    failOnBlocked.blockers.some((blocker) => blocker.id === "quality_below_threshold" && blocker.category === "quality_failed"),
    "quality_failed band blocker must attach to already-blocked candidates"
  );

  // --- P3 regression: operator-approved text-first fallback downgrades the media block ---
  const approvedTextFirstBundle: SiteBundle = structuredClone(weakBundle);
  approvedTextFirstBundle.presenceAssessment.textFirstFallbackApproval = {
    approvedBy: "operator_test",
    reason: "Asset library coverage pending; owner accepted text-first preview.",
    approvedAt: new Date().toISOString()
  };
  const approvedCompile = compileGeneratedSiteV3Site({ bundle: approvedTextFirstBundle });
  const approvedReport = evaluateGenerationQualityV2({ bundle: approvedTextFirstBundle, version: approvedCompile.version });
  assert.ok(
    !approvedReport.findings.some((finding) => finding.id === "media_plan_missing_visual_trade"),
    "approved text-first fallback must not block on media"
  );
  if (!approvedCompile.version.mediaDecisions.some((decision) => decision.rightsStatus === "approved" || decision.rightsStatus === "preclaim_safe")) {
    assert.ok(
      approvedReport.findings.some((finding) => finding.id === "media_plan_text_fallback_approved" && finding.severity === "advisory"),
      "approved text-first fallback must surface as an advisory finding"
    );
  }

  // --- Slice 3: brand-derived theming is deterministic, WCAG-clamped, preset-fallback ---
  const { deriveBrandThemeV2, parseCssColor, siteVariationSeedV2 } = await import("../lib/brand-derivation-v2");
  const { contrastRatioV3 } = await import("../lib/generated-site-v3-visual-controls");
  assert.deepEqual(parseCssColor("rgb(255, 196, 0)"), { r: 255, g: 196, b: 0 });
  assert.deepEqual(parseCssColor("#1f3a5f"), { r: 31, g: 58, b: 95 });
  assert.equal(parseCssColor("rgba(0, 0, 0, 0)"), undefined, "transparent samples carry no brand signal");
  const presetTheme = goodCompile.version.theme;
  assert.ok(presetTheme);
  const brandInspection = {
    target: "source_site",
    metrics: { brandColorSamples: ["rgb(255, 196, 12)", "rgb(24, 64, 132)", "rgb(20, 20, 20)", "rgb(240, 240, 240)"] }
  } as never;
  const derived = deriveBrandThemeV2({
    vertical: "auto_services",
    presetTheme,
    renderInspection: brandInspection
  });
  assert.equal(derived.report.applied, true, `expected derivation to apply: ${derived.report.reason}`);
  assert.ok(derived.theme);
  assert.ok(
    (contrastRatioV3("#ffffff", derived.theme.colors.primary) ?? 0) >= 4.5,
    `derived primary must hold 4.5:1 on white, got ${derived.theme.colors.primary}`
  );
  assert.ok(derived.report.selectedAccent, "two distinct hues must produce a derived accent");
  assert.ok(
    derived.report.selectedAccent === presetTheme.colors.accent ||
      (contrastRatioV3(derived.theme.colors.accent, derived.theme.colors.background) ?? 0) >= 3,
    `cue-derived accent must hold 3:1 on the page background, got ${derived.theme.colors.accent}`
  );
  const derivedAgain = deriveBrandThemeV2({ vertical: "auto_services", presetTheme, renderInspection: brandInspection });
  assert.deepEqual(derivedAgain.theme, derived.theme, "brand derivation must be deterministic");
  const noCues = deriveBrandThemeV2({
    vertical: "auto_services",
    presetTheme,
    renderInspection: { target: "source_site", metrics: { brandColorSamples: ["rgb(250, 250, 250)", "rgb(30, 30, 30)"] } } as never
  });
  assert.equal(noCues.theme, undefined, "neutral-only samples must fall back to the preset theme");
  assert.equal(siteVariationSeedV2("site_a"), siteVariationSeedV2("site_a"), "variation seed must be stable");
  assert.notEqual(siteVariationSeedV2("site_a"), siteVariationSeedV2("site_b"), "different sites must get different seeds");

  // --- Slice 2 Phase A: typed model visual QA findings are advisory-only ---
  const modelQaReport = evaluateGenerationQualityV2({
    bundle: goodBundle,
    version: goodCompile.version,
    visualQa: {
      siteId: goodBundle.businessProfile.siteId,
      source: "openai",
      model: "test",
      target: "generated_site",
      screenshotCount: 3,
      summary: "test",
      scoreScale: "visual_qa_score_100_v1",
      score: { craft: 70, overall: 70, brand: 70, layout: 70, copy: 70, conversion: 70, media: 70, mobile: 70 },
      findings: [
        {
          id: "model_contrast_issue",
          category: "accessibility",
          severity: "fail",
          title: "Low contrast facts",
          evidence: "Contact facts are hard to read on the dark panel.",
          viewport: "mobile",
          defectCategory: "contrast",
          confidence: 0.9
        },
        {
          id: "model_low_confidence",
          category: "brand",
          severity: "fail",
          title: "Maybe cramped",
          evidence: "Possibly cramped layout.",
          defectCategory: "cramped_layout",
          confidence: 0.3
        }
      ],
      limitations: []
    } as never
  });
  assert.ok(
    modelQaReport.findings.some((finding) => finding.id.startsWith("model_visual_contrast") && finding.severity === "advisory"),
    "high-confidence typed model defect must surface as advisory finding"
  );
  assert.ok(
    !modelQaReport.findings.some((finding) => finding.id.startsWith("model_visual_cramped")),
    "low-confidence model defects must be ignored"
  );
  assert.ok(modelQaReport.rubric.mobileCredibility <= 70, "severe mobile model defect must cap mobile credibility");
  assert.equal(
    applyQualityGateV2(readyQa(), modelQaReport).readiness,
    modelQaReport.overallScore >= qualityReadyThreshold ? "ready" : "blocked",
    "model findings alone must never block in Phase A"
  );
  assert.ok(
    !applyQualityGateV2(readyQa(), modelQaReport).blockers.some((blocker) => blocker.id.includes("model_visual")),
    "model findings must not map to blockers in Phase A"
  );

  // --- Slice 5 batch 1: vertical recipe acceptance (restaurant, home_services, beauty_salon) ---
  const recipeShells: Array<{ vertical: string; prompt: string; expectation: RegExp; ordering?: string[]; booking?: string[] }> = [
    {
      vertical: "restaurant",
      prompt: "Create a website for Casa Verde, a restaurant in Austin. Services: dine-in, takeout, catering. Phone: (512) 555-0301. Address: 401 Test Ave, Austin, TX 78702.",
      expectation: /\b(menu|order|dine|takeout|kitchen|catering)\b/i
    },
    {
      vertical: "home_services",
      prompt: "Create a website for Reyes Plumbing, a plumbing company in Austin. Services: drain cleaning, water heater repair, leak detection. Phone: (512) 555-0302. Address: 402 Test Ave, Austin, TX 78702.",
      expectation: /\b(repair|estimate|emergency|technician|home)\b/i
    },
    {
      vertical: "beauty_salon",
      prompt: "Create a website for Solace Salon, a hair salon in Austin. Services: cuts, balayage color, keratin treatments. Phone: (512) 555-0303. Address: 403 Test Ave, Austin, TX 78702.",
      expectation: /\b(hair|cut|color|stylist|book|appointment)\b/i
    }
  ];
  for (const shell of recipeShells) {
    const shellBundle = createSiteV3FromInput({ prompt: shell.prompt, identity: { siteId: `site_recipe_${shell.vertical}` } });
    assert.equal(shellBundle.businessProfile.vertical, shell.vertical, `${shell.prompt.slice(0, 40)} must classify as ${shell.vertical}`);
    shellBundle.businessProfile.photos = [1, 2, 3, 4].map((index) => ({
      id: `asset_safe_${shell.vertical}_${index}`,
      url: `https://assets.lodesta.example/${shell.vertical}-${index}.jpg`,
      alt: `Service photo ${index}`,
      source: "licensed" as const,
      rightsStatus: "preclaim_safe" as const
    }));
    const shellCompile = compileGeneratedSiteV3Site({ bundle: shellBundle });
    const shellJson = JSON.stringify(shellCompile.version.pageComposition);
    assert.ok(shell.expectation.test(shellJson), `${shell.vertical} recipe copy must use trade language`);
    assert.ok(!/Share the situation/.test(shellJson), `${shell.vertical} must not use generic process filler`);
    const shellReport = evaluateGenerationQualityV2({ bundle: shellBundle, version: shellCompile.version });
    assert.deepEqual(
      shellReport.findings.filter((finding) => finding.severity === "blocking"),
      [],
      `${shell.vertical} recipe must have no blocking findings: ${JSON.stringify(shellReport.findings)}`
    );
    assert.ok(
      shellReport.overallScore >= qualityReadyThreshold,
      `${shell.vertical} recipe must clear the acceptance threshold, got ${shellReport.overallScore} (${JSON.stringify(shellReport.rubric)})`
    );
  }

  // --- Slice 5: conversion-goal CTA selection ---
  const orderingBundle = createSiteV3FromInput({ prompt: recipeShells[0].prompt, identity: { siteId: "site_recipe_ordering" } });
  orderingBundle.businessProfile.orderingLinks = ["https://order.example/casa-verde"];
  const orderingCompile = compileGeneratedSiteV3Site({ bundle: orderingBundle });
  assert.ok(
    JSON.stringify(orderingCompile.version.pageComposition).includes("https://order.example/casa-verde"),
    "restaurant with ordering link must use it as the primary CTA"
  );

  // --- Slice 6: multi-page generation with anti-doorway rules ---
  {
    const multiBundle: SiteBundle = structuredClone(goodBundle);
    const multiDeck = mockCopyDeck();
    multiDeck.servicePages = [
      {
        serviceName: "10 Minute Flat Repair",
        hero: {
          heading: "Flat tire? Patched and back on the road in about 10 minutes.",
          body: "Pull into the Manchaca Rd shop with a flat and the crew checks whether the puncture is repairable before any work starts. Most patches cost $25."
        },
        detail: {
          heading: "When a flat can be repaired, and when it can't.",
          body: "A puncture in the tread with an intact sidewall can almost always be patched from the inside. Sidewall damage, long gashes, or a tire driven flat for miles usually means replacement; the crew shows you the damage either way before you decide anything."
        },
        faqs: [
          { question: "How much does a flat repair cost?", answer: "Flat repairs start at $25, confirmed before any work starts." },
          { question: "Can you patch run-flat tires?", answer: "Bring it in; run-flats depend on how far they were driven after losing pressure." },
          { question: "Should I drive on a flat to get there?", answer: "No. Driving on a flat destroys the sidewall; use the spare or call for the delivery option." },
          { question: "Is plugging or patching better?", answer: "An internal patch is more durable than a plug; the shop patches from inside the tire." }
        ],
        seo: { title: "Flat Repair in Austin | Austin Tireman", description: "Flat tire repair in about 10 minutes from $25 on Manchaca Rd in Austin. Pull in or call; the crew confirms repairability before any work starts." }
      },
      {
        serviceName: "Unrelated Widget Polishing",
        hero: { heading: "Widget polishing that no source fact supports here.", body: "This page should never generate because the business does not offer this service anywhere in the source facts at all." },
        detail: { heading: "Should not appear in output.", body: "This service is not in the business services list, so the anti-doorway rule must drop this page entirely instead of publishing an unsupported landing page for it." },
        faqs: [
          { question: "Why does this page exist at all?", answer: "It should not; the compiler must drop it before composition." },
          { question: "Is this service source-backed anywhere?", answer: "No, and that is exactly why the page must be dropped." },
          { question: "What is the expected behavior here then?", answer: "Fewer pages, never thinner or unsupported pages." },
          { question: "Who enforces this particular invariant?", answer: "buildServiceLandingPagesV3 plus the quality gate backstop." }
        ],
        seo: { title: "Widget Polishing | Should Not Ship", description: "An unsupported service page that the anti-doorway enforcement must drop before it ever reaches a composed site page list." }
      }
    ];
    multiBundle.presenceAssessment.generatedCopyDeck = multiDeck;
    const multiCompile = compileGeneratedSiteV3Site({ bundle: multiBundle });
    const pageSlugs = multiCompile.version.pageComposition.pages.map((page) => page.slug);
    assert.ok(pageSlugs.includes("services/10-minute-flat-repair"), `source-backed service must get a landing page: ${pageSlugs.join(", ")}`);
    assert.ok(!pageSlugs.some((slug) => slug.includes("widget")), "non-source-backed service must not get a page");
    assert.equal(multiCompile.version.pageComposition.pages.map((page) => page.slug).join(","), pageSlugs.join(","), "pageComposition must include service pages for sitemap/claims");
    const servicePage = multiCompile.version.pageComposition.pages.find((page) => page.slug === "services/10-minute-flat-repair");
    assert.equal(servicePage?.purpose, "service_landing");
    assert.ok((servicePage?.sections.length ?? 0) >= 4, "service page must compose hero/detail/faq/contact");
    const multiReport = evaluateGenerationQualityV2({ bundle: multiBundle, version: multiCompile.version });
    assert.ok(
      !multiReport.findings.some((finding) => finding.id.startsWith("service_page_duplicate_copy")),
      "distinct service page must not trigger the doorway backstop"
    );

    // Doorway backstop: a near-duplicate page injected past the compiler must block.
    const doorwayVersion = structuredClone(multiCompile.version) as SiteVersionV3;
    const homePage = doorwayVersion.pageComposition.pages[0];
    doorwayVersion.pageComposition.pages.push({
      ...homePage,
      id: "page_doorway",
      slug: "doorway-clone",
      title: "Doorway Clone",
      purpose: "service_landing"
    });
    const doorwayReport = evaluateGenerationQualityV2({ bundle: multiBundle, version: doorwayVersion });
    assert.ok(
      doorwayReport.findings.some((finding) => finding.id === "service_page_duplicate_copy_doorway-clone" && finding.severity === "blocking"),
      `doorway clone must be blocked: ${JSON.stringify(doorwayReport.findings.map((finding) => finding.id))}`
    );
    assert.equal(applyQualityGateV2(readyQa(), doorwayReport).readiness, "blocked");

    // Default-services businesses never get service pages.
    const defaultsBundle: SiteBundle = structuredClone(defaultServicesBundle);
    defaultsBundle.presenceAssessment.generatedCopyDeck = { ...mockCopyDeck(), servicePages: multiDeck.servicePages };
    const defaultsCompile = compileGeneratedSiteV3Site({ bundle: defaultsBundle });
    assert.equal(defaultsCompile.version.pageComposition.pages.length, 1, "vertical-default services must not earn landing pages");
  }

  // --- review round 3 regressions ---
  {
    const { computeSiteModelHash } = await import("../lib/site-version-metadata");

    // P1: the V3 hash must cover pageComposition so repairs/edits are detectable.
    const hashBundle: SiteBundle = structuredClone(weakBundle);
    const hashCompile = compileGeneratedSiteV3Site({ bundle: hashBundle });
    const hashBefore = computeSiteModelHash(hashBundle, hashCompile.version);
    const hashHero = hashCompile.version.pageComposition.pages[0].sections.find((section) => section.id === "hero");
    assert.ok(hashHero);
    const hashVisual = structuredClone(getVisualSectionV3(hashHero.props));
    assert.ok(hashVisual);
    ((hashVisual.slots as Record<string, unknown>).copy as Record<string, unknown>).heading = "A post-QA mutation that must invalidate readiness.";
    hashHero.props = withVisualSectionV3({ ...hashHero.props }, hashVisual);
    assert.notEqual(
      computeSiteModelHash(hashBundle, hashCompile.version),
      hashBefore,
      "pageComposition mutations must change the V3 site model hash"
    );

    // P2: cleaned services keep source backing in normalized facts; no precompile block.
    const { evaluatePreCompileResolutionGateV2 } = await import("../lib/precompile-resolution-gate");
    const serviceFacts = weakBundle.presenceAssessment.normalizedBusinessFacts?.services ?? [];
    const flatRepairFact = serviceFacts.find((entry) => entry.value === "10 Minute Flat Repair");
    assert.ok(flatRepairFact, "cleaned service must appear in normalized facts");
    assert.equal(flatRepairFact.source, "crawl", "cleaned service must keep crawl provenance, not system_default");
    assert.equal(evaluatePreCompileResolutionGateV2(weakBundle).status, "ready", "cleaned services must not trip the precompile resolution gate");

    // P1/P2: nav links honor basePath and service-page forms attribute their own pageId.
    const { renderToReadableStream } = await import("react-dom/server.edge");
    const { SiteRenderer } = await import("../lib/site-renderer");
    const renderHtml = async (bundle: SiteBundle, pageSlug: string, basePath?: string) => {
      const renderBundle = structuredClone(bundle);
      const compile = compileGeneratedSiteV3Site({ bundle: renderBundle });
      renderBundle.siteModel.versions = [compile.version];
      const stream = await renderToReadableStream(
        React.createElement(SiteRenderer, {
          business: renderBundle.businessProfile,
          site: renderBundle.siteModel,
          extensions: renderBundle.extensionModel,
          version: compile.version,
          pageSlug,
          tracking: false,
          formsEnabled: true,
          basePath
        })
      );
      await stream.allReady;
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let html = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value);
      }
      return html;
    };

    const multiPageBundle: SiteBundle = structuredClone(goodBundle);
    const navDeck = mockCopyDeck();
    navDeck.servicePages = [
      {
        serviceName: "10 Minute Flat Repair",
        hero: { heading: "Flat tire? Patched in about 10 minutes.", body: "Pull into the Manchaca Rd shop with a flat and the crew checks whether the puncture is repairable before any work starts." },
        detail: { heading: "Repairable or not, you decide with the tire in view.", body: "A puncture in the tread with an intact sidewall can almost always be patched from the inside. Sidewall damage or a tire driven flat for miles usually means replacement; the crew shows you the damage either way." },
        faqs: [
          { question: "How much does a flat repair cost?", answer: "Flat repairs start at $25, confirmed before any work starts." },
          { question: "Can you patch run-flat tires?", answer: "Bring it in; run-flats depend on how far they were driven after losing pressure." },
          { question: "Should I drive on a flat to get there?", answer: "No. Driving on a flat destroys the sidewall; use the spare instead." },
          { question: "Is plugging or patching better?", answer: "An internal patch is more durable than a plug; the shop patches from inside the tire." }
        ],
        seo: { title: "Flat Repair in Austin | Austin Tireman", description: "Flat tire repair in about 10 minutes from $25 on Manchaca Rd in Austin. Pull in or call; repairability confirmed before any work starts." }
      }
    ];
    multiPageBundle.presenceAssessment.generatedCopyDeck = navDeck;

    const servicePageSlug = "services/10-minute-flat-repair";
    const platformHtml = await renderHtml(multiPageBundle, servicePageSlug);
    assert.ok(
      platformHtml.includes(`value="page_services_10-minute-flat-repair"`),
      "service-page form must attribute leads to its own pageId"
    );
    assert.ok(
      platformHtml.includes(`/sites/${multiPageBundle.siteModel.slug}/${servicePageSlug}`),
      "platform render must use /sites base path in nav"
    );

    const customDomainHtml = await renderHtml(multiPageBundle, servicePageSlug, "");
    assert.ok(
      !customDomainHtml.includes(`href="/sites/`),
      "custom-domain render must never link back to /sites platform paths"
    );
    assert.ok(
      customDomainHtml.includes(`href="/${servicePageSlug}"`),
      "custom-domain render must use domain-root service links"
    );
  }

  // --- Slice A: typography rotation, lockup, FAQ accordion, header phone CTA ---
  {
    const { compileGeneratedSiteV3Site: compile } = await import("../lib/generated-site-v3-compiler");
    const pairingFor = (siteId: string, vertical?: string) => {
      const pairingBundle: SiteBundle = structuredClone(weakBundle);
      pairingBundle.businessProfile.siteId = siteId;
      if (vertical) pairingBundle.businessProfile.vertical = vertical as never;
      return compile({ bundle: pairingBundle }).version.artDirection.fontPairingId;
    };
    assert.equal(pairingFor("site_pair_test_a"), pairingFor("site_pair_test_a"), "font pairing must be deterministic per site");
    const pairings = new Set(["a", "b", "c", "d", "e", "f"].map((suffix) => pairingFor(`site_pair_${suffix}`)));
    assert.ok(pairings.size >= 2, `same-vertical sites must rotate font pairings, got ${[...pairings].join(", ")}`);

    const { renderToReadableStream } = await import("react-dom/server.edge");
    const { SiteRenderer } = await import("../lib/site-renderer");
    const sliceABundle: SiteBundle = structuredClone(weakBundle);
    const sliceACompile = compile({ bundle: sliceABundle });
    sliceABundle.siteModel.versions = [sliceACompile.version];
    const stream = await renderToReadableStream(
      React.createElement(SiteRenderer, {
        business: sliceABundle.businessProfile,
        site: sliceABundle.siteModel,
        extensions: sliceABundle.extensionModel,
        version: sliceACompile.version,
        pageSlug: "",
        tracking: false,
        formsEnabled: false
      })
    );
    await stream.allReady;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let sliceAHtml = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sliceAHtml += decoder.decode(value);
    }
    assert.ok(sliceAHtml.includes("Call (512) 447-8473"), "header CTA must show the formatted phone number");
    assert.ok(sliceAHtml.includes("site-brand-lockup-v3"), "no-logo header must render the typographic lockup");
    assert.ok(!/site-brand-mark-v3[^>]*>[A-Z]</.test(sliceAHtml), "monogram letter box must not render");
    assert.ok(sliceAHtml.includes('data-presentation="faq_accordion"'), "FAQ must render the accordion presentation");
    assert.ok(sliceAHtml.includes("<summary>"), "FAQ must use native disclosure semantics");
    assert.ok(sliceAHtml.includes(`data-font-pairing="${sliceACompile.version.artDirection.fontPairingId}"`), "font pairing must reach the rendered markup");

    // Font catalog reconciliation: every pairing's stacks resolve to families in the CSS import.
    const cssSource = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf-8");
    const importLine = cssSource.split("\n")[0];
    const loadedFamilies = ["Archivo", "Cormorant Garamond", "DM Sans", "Figtree", "Fraunces", "Libre Franklin", "Manrope", "Sora", "Space Grotesk"];
    for (const family of loadedFamilies) {
      assert.ok(importLine.includes(family.replace(/ /g, "+")), `font import must load ${family}`);
    }
    const rendererSource = readFileSync(path.join(process.cwd(), "lib", "site-renderer-v3.tsx"), "utf-8");
    const stacksBlock = rendererSource.slice(rendererSource.indexOf("function fontStacks"), rendererSource.indexOf("function fontStacks") + 2400);
    for (const stale of ["IBM Plex", "Nunito", "Public Sans", "Work Sans", "Source Serif", "Source Sans", "Roboto Condensed"]) {
      assert.ok(!stacksBlock.includes(stale), `fontStacks must not reference unloaded family ${stale}`);
    }
  }

  // --- Slice B1: substrate-aware presentation catalog validation ---
  {
    const { validateSectionPresentationMapV3, compatiblePresentationsForRoleV3 } = await import(
      "../lib/generated-site-v3-art-direction-catalog"
    );
    assert.deepEqual(
      validateSectionPresentationMapV3({ services: "coaching_cards", faq: "faq_accordion", gallery: "mosaic" }),
      [],
      "compatible presentations must validate cleanly"
    );
    const crossSubstrate = validateSectionPresentationMapV3({ services: "collage" as never });
    assert.equal(crossSubstrate.length, 1, "media presentation on a list role must be rejected");
    assert.ok(crossSubstrate[0].reason.includes("not compatible"));
    const speculative = validateSectionPresentationMapV3({ faq: "qa_grid" as never });
    assert.equal(speculative.length, 1, "speculative presentations without CSS must be rejected");
    // Every allowlisted presentation has CSS backing it (faq_accordion included).
    const cssForCatalog = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf-8");
    const cssBacked = new Set([...cssForCatalog.matchAll(/data-presentation="([a-z_]+)"/g)].map((match) => match[1]));
    cssBacked.add("stacked"); // default facts styling, no dedicated variant block
    cssBacked.add("single"); // default media styling
    for (const allowed of Object.values(compatiblePresentationsForRoleV3).flat()) {
      assert.ok(cssBacked.has(allowed), `catalog presentation "${allowed}" must have CSS backing`);
    }
  }

  // --- Slice B2-B4: selector diversity + presentation map reaches markup ---
  {
    const { compileGeneratedSiteV3Site: compile } = await import("../lib/generated-site-v3-compiler");
    const fingerprintFor = (siteId: string) => {
      const fpBundle: SiteBundle = structuredClone(weakBundle);
      fpBundle.businessProfile.siteId = siteId;
      const art = compile({ bundle: fpBundle }).version.artDirection;
      return JSON.stringify({ font: art.fontPairingId, card: art.cardTreatment, presentation: art.sectionPresentation });
    };
    const canonicalSeeds = Array.from({ length: 12 }, (_, index) => `site_diversity_${index}`);
    const fingerprints = canonicalSeeds.map(fingerprintFor);
    const distinct = new Set(fingerprints);
    assert.ok(distinct.size >= 8, `bounded diversity: expected >=8 distinct fingerprints across 12 seeds, got ${distinct.size}`);
    const shareCounts = new Map<string, number>();
    for (const fingerprint of fingerprints) shareCounts.set(fingerprint, (shareCounts.get(fingerprint) ?? 0) + 1);
    assert.ok(Math.max(...shareCounts.values()) <= 3, "no single fingerprint may dominate the canonical seed set");
    assert.equal(fingerprintFor("site_diversity_0"), fingerprintFor("site_diversity_0"), "fingerprints must be deterministic");

    // Presentation choices must be valid and reach rendered markup.
    const { validateSectionPresentationMapV3 } = await import("../lib/generated-site-v3-art-direction-catalog");
    const presBundle: SiteBundle = structuredClone(weakBundle);
    presBundle.businessProfile.siteId = "site_presentation_check";
    const presCompile = compile({ bundle: presBundle });
    const presMap = presCompile.version.artDirection.sectionPresentation;
    assert.ok(presMap, "selector must emit a section presentation map");
    assert.deepEqual(validateSectionPresentationMapV3(presMap), [], "selector output must validate against the catalog");
    presBundle.siteModel.versions = [presCompile.version];
    const { renderToReadableStream } = await import("react-dom/server.edge");
    const { SiteRenderer } = await import("../lib/site-renderer");
    const presStream = await renderToReadableStream(
      React.createElement(SiteRenderer, {
        business: presBundle.businessProfile,
        site: presBundle.siteModel,
        extensions: presBundle.extensionModel,
        version: presCompile.version,
        pageSlug: "",
        tracking: false,
        formsEnabled: false
      })
    );
    await presStream.allReady;
    const presReader = presStream.getReader();
    const presDecoder = new TextDecoder();
    let presHtml = "";
    for (;;) {
      const { done, value } = await presReader.read();
      if (done) break;
      presHtml += presDecoder.decode(value);
    }
    assert.ok(
      presHtml.includes(`data-presentation="${presMap.services}"`),
      `selected services presentation (${presMap.services}) must reach rendered markup`
    );
    assert.ok(
      presHtml.includes(`data-presentation="${presMap.factsStrip}"`),
      `selected facts presentation (${presMap.factsStrip}) must reach rendered markup`
    );
    assert.ok(presHtml.includes(`data-card-treatment="${presCompile.version.artDirection.cardTreatment}"`), "card treatment must reach the root attribute");
  }

  // --- Slice C: wordmark candidates are review-only and never reach public output ---
  {
    const { generateWordmarkCandidateV2, wordmarkCandidateArtifactV2 } = await import("../lib/brand-wordmark-v2");
    const wmCompile = compileGeneratedSiteV3Site({ bundle: structuredClone(weakBundle) });
    assert.ok(wmCompile.version.theme);
    const candidate = generateWordmarkCandidateV2({
      business: weakBundle.businessProfile,
      theme: wmCompile.version.theme,
      fontPairingId: wmCompile.version.artDirection.fontPairingId
    });
    assert.equal(candidate.allowedPublicOutput, false, "wordmark candidates are hard-gated from public output");
    assert.ok(candidate.svg.includes("Austin Tireman"), "wordmark renders the business name");
    assert.deepEqual(
      candidate,
      generateWordmarkCandidateV2({ business: weakBundle.businessProfile, theme: wmCompile.version.theme, fontPairingId: wmCompile.version.artDirection.fontPairingId }),
      "wordmark generation is deterministic"
    );
    const wmArtifact = wordmarkCandidateArtifactV2({ siteCandidateId: "sitecand_test_wm", candidate, createdAt: "2026-06-10T00:00:00.000Z" });
    assert.equal(wmArtifact.artifactType, "brand_mark_generation_report");
    assert.equal((wmArtifact.payload as { reviewOnly?: boolean }).reviewOnly, true);
    const wmJson = JSON.stringify(wmCompile.version.pageComposition);
    assert.ok(!wmJson.includes("wordmark"), "no wordmark output may appear in the public page composition");
  }

  // --- Slice D: per-image attestation model + scraped-image attestation flow ---
  {
    const { applyOwnerAssetsUpdate, parseAssetAttestation } = await import("../lib/owner-assets");
    const attBundle: SiteBundle = structuredClone(weakBundle);
    const scrapedId = attBundle.businessProfile.photos.find((photo) => photo.rightsStatus === "reference_only")?.id;
    assert.ok(scrapedId, "fixture must include scraped reference_only photos");

    const rejected = applyOwnerAssetsUpdate(structuredClone(attBundle), {
      siteId: attBundle.businessProfile.siteId,
      attestedBy: "owner@example.com",
      photos: [{ url: "https://assets.example/unconfirmed.jpg", alt: "Unconfirmed", rightsConfirmed: false }]
    });
    assert.ok(!rejected.ok && rejected.reason.includes("Unconfirmed"), "unconfirmed images must be rejected by name");

    const accepted = applyOwnerAssetsUpdate(structuredClone(attBundle), {
      siteId: attBundle.businessProfile.siteId,
      attestedBy: "owner@example.com",
      photos: [{ url: "https://assets.example/confirmed.jpg", alt: "Confirmed bay photo", rightsConfirmed: true }],
      scrapedAttestations: [{ assetId: scrapedId, rightsConfirmed: true }]
    });
    assert.ok(accepted.ok, accepted.ok ? "" : accepted.reason);
    if (accepted.ok) {
      assert.ok(
        accepted.photos.some((photo) => photo.id === scrapedId && photo.rightsStatus === "customer_granted"),
        "attested scraped image must become customer_granted"
      );
      for (const asset of accepted.assets) {
        const attestation = parseAssetAttestation(asset.metadata);
        assert.ok(attestation, "every owner asset must round-trip a typed attestation");
        assert.equal(attestation.attestedBy, "owner@example.com");
        assert.equal(attestation.imageHash.length, 64, "attestation carries the image hash");
      }
    }
    const ownerAssetsSource = readFileSync(path.join(process.cwd(), "lib", "owner-assets.ts"), "utf-8");
    assert.ok(!ownerAssetsSource.includes("rightsAccepted"), "blanket rights acceptance must not exist in the model");
  }

  // --- Slice E: proof modes (link-only unclaimed, capped previews, none for QA) ---
  {
    const { consumePreviewProofSlot, resetLiveProofStateForTests } = await import("../lib/live-proof");
    const originalCap = process.env.LODESTA_PREVIEW_PROOF_DAILY_CAP;
    try {
      process.env.LODESTA_PREVIEW_PROOF_DAILY_CAP = "2";
      resetLiveProofStateForTests();
      assert.equal(consumePreviewProofSlot(), true);
      assert.equal(consumePreviewProofSlot(), true);
      assert.equal(consumePreviewProofSlot(), false, "preview proof cap must hold");
    } finally {
      if (originalCap === undefined) delete process.env.LODESTA_PREVIEW_PROOF_DAILY_CAP;
      else process.env.LODESTA_PREVIEW_PROOF_DAILY_CAP = originalCap;
      resetLiveProofStateForTests();
    }

    const { renderToReadableStream } = await import("react-dom/server.edge");
    const { SiteRenderer } = await import("../lib/site-renderer");
    const proofBundle: SiteBundle = structuredClone(weakBundle);
    const proofCompile = compileGeneratedSiteV3Site({ bundle: proofBundle });
    proofBundle.siteModel.versions = [proofCompile.version];
    const proofLocation = {
      id: "loc_proof_test",
      businessId: "biz_proof_test",
      address: proofBundle.businessProfile.address,
      serviceAreas: ["Austin"],
      phone: proofBundle.businessProfile.phone,
      googlePlaceId: "ChIJtest_place_id",
      provenance: {},
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z"
    };
    const renderProof = async (proofMode: "ui_kit" | "link_only" | "none" | undefined) => {
      const stream = await renderToReadableStream(
        React.createElement(SiteRenderer, {
          business: proofBundle.businessProfile,
          site: proofBundle.siteModel,
          extensions: proofBundle.extensionModel,
          locations: [proofLocation as never],
          version: proofCompile.version,
          pageSlug: "",
          tracking: false,
          formsEnabled: false,
          proofMode
        })
      );
      await stream.allReady;
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let html = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value);
      }
      return html;
    };
    const linkOnlyHtml = await renderProof("link_only");
    assert.ok(linkOnlyHtml.includes("Read our reviews on Google Maps"), "link-only mode must render the maps CTA");
    assert.ok(linkOnlyHtml.includes("place_id:ChIJtest_place_id"), "link CTA must target the place id");
    const noneHtml = await renderProof(undefined);
    assert.ok(!noneHtml.includes("site-google-proof-v3"), "default/none mode must render no proof block (QA hermetic)");
    assert.ok(!noneHtml.includes("site-live-rating-v3"), "the old live rating badge must be gone");
  }

  // --- Phase 0: deck slot coverage, voice lint, meta-copy gate ---
  {
    const { lintGeneratedCopyDeck: lint, detectMetaInstructionalCopy, voiceProfileForBusiness } = await import("../lib/generated-copy-v2");
    assert.equal(detectMetaInstructionalCopy("Use the photos to decide what to ask about when you reach out."), "Meta-instructional copy about the site's own photos.");
    assert.equal(detectMetaInstructionalCopy("A composed first step for Austin Tireman."), "Template filler heading.");
    assert.equal(detectMetaInstructionalCopy("We patch most flats in about ten minutes."), undefined);
    assert.equal(voiceProfileForBusiness({ vertical: "auto_services" }).pov, "first_plural");
    assert.equal(voiceProfileForBusiness({ vertical: "med_spa" }).pov, "brand_direct");

    const voiceDeck = mockCopyDeck();
    assert.deepEqual(lint(voiceDeck, { businessName: "Austin Tireman" }), [], "good first-plural deck passes voice lint");
    const sludgeDeck = structuredClone(voiceDeck);
    sludgeDeck.hero.body = "Austin Tireman handles flats. It is on Manchaca Rd.";
    sludgeDeck.servicesIntro.body = "Austin Tireman sells used tires. It also does delivery.";
    sludgeDeck.splitMedia.body = "Austin Tireman checks each tire. It quotes prices first.";
    sludgeDeck.contactIntro.body = "Austin Tireman answers calls during open hours daily here.";
    const sludgeViolations = lint(sludgeDeck, { businessName: "Austin Tireman" });
    assert.ok(sludgeViolations.some((violation) => violation.includes("Third-person drift")), `expected third-person drift, got ${sludgeViolations.join(" | ")}`);
    const metaDeck = structuredClone(voiceDeck);
    metaDeck.gallery.body = "Use the photos to decide what to ask about.";
    assert.ok(lint(metaDeck, { businessName: "Austin Tireman" }).length >= 1, "meta copy must fail lint");

    // Compiler consumes the new deck slots; fallbacks are factual, not meta.
    const deckBundle: SiteBundle = structuredClone(weakBundle);
    deckBundle.businessProfile.photos = Array.from({ length: 5 }, (_, index) => ({
      id: `deck_photo_${index + 1}`,
      url: `https://assets.example/deck-photo-${index + 1}.jpg`,
      alt: `Service photo ${index + 1}`,
      source: "licensed" as const,
      rightsStatus: "preclaim_safe" as const
    }));
    deckBundle.presenceAssessment.generatedCopyDeck = mockCopyDeck();
    const deckCompile = compileGeneratedSiteV3Site({ bundle: deckBundle });
    const deckJson = JSON.stringify(deckCompile.version.pageComposition);
    assert.ok(deckJson.includes("Most tire problems are solved in one visit."), "split media must use deck copy");
    assert.ok(deckJson.includes("The work, up close."), "gallery must use deck copy");
    const noDeckBundle: SiteBundle = structuredClone(weakBundle);
    noDeckBundle.presenceAssessment.generatedCopyDeck = undefined;
    const noDeckJson = JSON.stringify(compileGeneratedSiteV3Site({ bundle: noDeckBundle }).version.pageComposition);
    assert.ok(!/composed first (step|stop)|one clean frame|use the photos/i.test(noDeckJson), "filler copy must be gone from fallbacks");

    // Gate: meta copy is a blocking finding even if it sneaks into a composition.
    const metaBundle: SiteBundle = structuredClone(weakBundle);
    const metaCompile = compileGeneratedSiteV3Site({ bundle: metaBundle });
    const heroSection = metaCompile.version.pageComposition.pages[0].sections.find((section) => section.props?.visualSectionV3);
    assert.ok(heroSection);
    (heroSection.props.visualSectionV3 as { slots: { copy: { body: string } } }).slots.copy.body = "Use the photos to decide what to ask about.";
    metaBundle.siteModel.versions = [metaCompile.version];
    const metaReport = evaluateGenerationQualityV2({ bundle: metaBundle, version: metaCompile.version });
    assert.ok(metaReport.findings.some((finding) => finding.id === "meta_copy_visible" && finding.severity === "blocking"), "meta copy must block at the gate");
  }

  // --- Phase 0.5: model QA Phase B promotion ---
  {
    const promoBundle: SiteBundle = structuredClone(weakBundle);
    const promoCompile = compileGeneratedSiteV3Site({ bundle: promoBundle });
    promoBundle.siteModel.versions = [promoCompile.version];
    const visualQa = {
      source: "openai" as const,
      status: "fail" as const,
      findings: [
        { id: "vq1", severity: "fail" as const, summary: "x", evidence: "Header overlaps hero text on mobile.", defectCategory: "overflow" as const, confidence: 0.9, viewport: "mobile" as const },
        { id: "vq2", severity: "fail" as const, summary: "y", evidence: "Imagery repeats.", defectCategory: "repetition" as const, confidence: 0.95, viewport: "desktop" as const },
        { id: "vq3", severity: "fail" as const, summary: "z", evidence: "Maybe blank.", defectCategory: "blank_layout" as const, confidence: 0.6, viewport: "desktop" as const }
      ]
    };
    const promoReport = evaluateGenerationQualityV2({ bundle: promoBundle, version: promoCompile.version, visualQa: visualQa as never });
    const overflowFinding = promoReport.findings.find((finding) => finding.id === "model_visual_overflow_mobile");
    const repetitionFinding = promoReport.findings.find((finding) => finding.id === "model_visual_repetition_desktop");
    const lowConfFinding = promoReport.findings.find((finding) => finding.id === "model_visual_blank_layout_desktop");
    assert.equal(overflowFinding?.severity, "blocking", "objective high-confidence defect must block");
    assert.equal(repetitionFinding?.severity, "advisory", "subjective defect stays advisory");
    assert.equal(lowConfFinding?.severity, "advisory", "low-confidence objective defect stays advisory");
  }

  // --- Phase 1: service catalog mapping + evidence candidates ---
  {
    const { matchServiceDefinition, serviceDefinitionsForVertical } = await import("../lib/service-catalog");
    assert.equal(matchServiceDefinition("auto_services", "10 Minute Flat Repair Starting At $25")?.slug, "flat-repair");
    assert.equal(matchServiceDefinition("auto_services", "Used Tires")?.slug, "used-tires");
    assert.equal(matchServiceDefinition("auto_services", "Tire Rotation")?.slug, "tire-rotation");
    assert.equal(matchServiceDefinition("auto_services", "Ceramic Coating"), undefined, "unknown services stay custom");
    assert.ok(serviceDefinitionsForVertical("auto_services").length >= 8, "auto_services catalog is seeded");

    const { factCandidatesFromBundle, selectCandidatesForPreview, proposedBusinessServices } = await import("../lib/business-evidence");
    const evidenceBundle: SiteBundle = structuredClone(weakBundle);
    const candidates = factCandidatesFromBundle(evidenceBundle, "biz_evidence_test");
    assert.ok(candidates.some((candidate) => candidate.fieldKey === "phone" && candidate.proposedValue));
    assert.ok(candidates.filter((candidate) => candidate.fieldKey === "service").length >= 2);
    for (const candidate of candidates.filter((entry) => entry.sourceType === "google_places")) {
      assert.equal(candidate.proposedValue, undefined, "google_places candidates must not store values");
    }
    const selected = selectCandidatesForPreview(candidates);
    const phoneSelected = selected.filter((candidate) => candidate.fieldKey === "phone" && candidate.status === "system_selected_for_preview");
    assert.equal(phoneSelected.length, 1, "exactly one phone candidate selected for preview");
    assert.ok(!selected.some((candidate) => candidate.status === ("accepted" as never)), "no candidate is ever called accepted");

    const services = proposedBusinessServices("biz_evidence_test", "auto_services", evidenceBundle.businessProfile);
    assert.ok(services.length >= 2);
    assert.ok(services.every((record) => record.status === "proposed"));
    assert.ok(services.some((record) => record.serviceDefinitionId === "svc_auto_services_flat-repair"), JSON.stringify(services.map(s => s.serviceDefinitionId ?? s.customName)));

    // Local repository round-trip incl. owner decisions surviving re-proposal.
    const { replaceProposedBusinessServices, listBusinessServices, updateBusinessService, replaceFactCandidates, listFactCandidates } = await import("../lib/store");
    replaceProposedBusinessServices("biz_evidence_test", services);
    const stored = listBusinessServices("biz_evidence_test");
    assert.equal(stored.length, services.length);
    const confirmed = updateBusinessService({ id: stored[0].id, status: "active", confirmedBy: "owner@example.com" });
    assert.equal(confirmed?.status, "active");
    assert.equal(confirmed?.confirmationSource, "owner");
    replaceProposedBusinessServices("biz_evidence_test", services);
    const afterReproposal = listBusinessServices("biz_evidence_test");
    assert.ok(afterReproposal.some((record) => record.id === stored[0].id && record.status === "active"), "owner decisions survive re-proposal");
    replaceFactCandidates("biz_evidence_test", selected);
    assert.equal(listFactCandidates("biz_evidence_test").length, selected.length);
  }

  // --- Phase 1.5/3/4: access levels, drift, schema.org, owner report ---
  {
    const { actionAllowedAtLevel } = await import("../lib/owner-access");
    assert.equal(actionAllowedAtLevel("toggle_service", "contact_verified"), true);
    assert.equal(actionAllowedAtLevel("change_domain", "contact_verified"), false, "phone access cannot repoint a domain");
    assert.equal(actionAllowedAtLevel("change_domain", "owner_verified"), true);
    assert.equal(actionAllowedAtLevel("delete_account", "contact_verified"), false);

    const { detectDrift } = await import("../lib/drift-detection");
    const drift = detectDrift("biz_drift_test", [
      { fieldKey: "hours", sourceType: "website", currentValue: "8-5", observedValue: "9-6", evidenceLabel: "Found on your website", evidenceUrl: "https://example.com" },
      { fieldKey: "hours", sourceType: "google_places", currentValue: "8-5", observedValue: "9-6", evidenceLabel: "Listed on Google", placeId: "ChIJdrift" },
      { fieldKey: "phone", sourceType: "website", currentValue: "512-555-0100", observedValue: "512-555-0100", evidenceLabel: "x" }
    ]);
    assert.equal(drift.length, 2, "unchanged values produce no drift");
    assert.ok(drift.every((row) => row.status === "drift_candidate"));
    const placesDrift = drift.find((row) => row.sourceType === "google_places");
    assert.ok(placesDrift);
    assert.equal(placesDrift.proposedValue, undefined, "places drift rows never persist values");
    assert.deepEqual(placesDrift.comparisonResult, { differs_from_confirmed: true });

    const { faqPageJsonLd } = await import("../lib/public-site-schema");
    const schemaBundle: SiteBundle = structuredClone(weakBundle);
    const schemaCompile = compileGeneratedSiteV3Site({ bundle: schemaBundle });
    schemaBundle.siteModel.versions = [schemaCompile.version];
    const faqSchema = faqPageJsonLd(schemaCompile.version, schemaCompile.version.pageComposition.pages[0].id);
    assert.ok(faqSchema, "faq schema generates from the composed FAQ section");
    assert.equal((faqSchema as { mainEntity: unknown[] }).mainEntity.length, 4);

    const { buildOwnerSiteReport } = await import("../lib/owner-site-report");
    const reportVersion = { ...schemaCompile.version, generationQa: { qualityReport: { overallScore: 89, rubric: { mobileCredibility: 60, sectionQuality: 70, sourceGrounding: 100 } } } };
    const report = buildOwnerSiteReport(reportVersion as never);
    assert.equal(report.overallScore, 89);
    assert.ok(report.grounding.statement.includes("verified fact"));

    const { classifySearchSource, searchCandidate, webSearchEvidenceEnabled } = await import("../lib/web-search-evidence");
    assert.equal(classifySearchSource("https://www.yelp.com/biz/austin-tireman"), undefined, "yelp excluded pending ToS decision");
    assert.equal(classifySearchSource("https://austintireman.com/services", "austintireman.com"), "first_party_website");
    assert.equal(classifySearchSource("https://tdlr.texas.gov/license/123"), "government_registry");
    assert.equal(webSearchEvidenceEnabled(), false, "web search is off by default");
    const searchRow = searchCandidate({ businessId: "biz_x", fieldKey: "service", value: "Tire Rotation", excerpt: "rotation", url: "https://austintireman.com", sourceClass: "first_party_website" });
    assert.equal(searchRow.sourceType, "web_search");
    assert.equal(searchRow.status, "discovered");
  }

  // --- Publish-risk tiers (diff-based) ---
  {
    const { summarizePublishDiff, publishRiskTierForDiff } = await import("../lib/publish-risk");
    const riskBundle: SiteBundle = structuredClone(weakBundle);
    const baseVersion = compileGeneratedSiteV3Site({ bundle: riskBundle }).version;
    const sameDiff = summarizePublishDiff(baseVersion, structuredClone(baseVersion));
    assert.equal(publishRiskTierForDiff("update_hours", sameDiff), "safe", "contained hours edit is safe");
    const grownBundle: SiteBundle = structuredClone(weakBundle);
    grownBundle.businessProfile.siteId = riskBundle.businessProfile.siteId;
    grownBundle.presenceAssessment.generatedCopyDeck = mockCopyDeck();
    grownBundle.presenceAssessment.generatedCopyDeck.servicePages = [
      {
        serviceName: "10 Minute Flat Repair",
        hero: { heading: "Flat repair done in about ten minutes", body: "We patch most repairable flats while you wait, with the price quoted before any work starts on your tire." },
        detail: { heading: "What the flat repair includes", body: "We pull the tire, find the leak, patch it from the inside, rebalance the wheel, and torque it back on. If the damage cannot be repaired safely, we will tell you before any work starts and walk through used tire options." },
        faqs: [
          { question: "Can my flat tire be repaired instead of replaced?", answer: "Most punctures in the tread can be patched; sidewall damage usually means replacement." },
          { question: "How long does a typical flat repair take?", answer: "Most repairs are done in about ten minutes once the tire is in the bay." },
          { question: "Do I need an appointment for a flat repair?", answer: "Walk-ins work for most flats; calling ahead confirms the bay is free." },
          { question: "Will you check my other tires during the visit?", answer: "We give the other tires a quick visual check and flag anything that looks unsafe." }
        ],
        seo: { title: "10 Minute Flat Repair in Austin", description: "Flat tire repair in about ten minutes from the Manchaca Rd shop, with the price quoted before any work starts." }
      }
    ];
    const grownVersion = compileGeneratedSiteV3Site({ bundle: grownBundle }).version;
    const growthDiff = summarizePublishDiff(baseVersion, grownVersion);
    assert.equal(growthDiff.pageCountChanged, true, "new service page changes page count");
    assert.equal(publishRiskTierForDiff("service_on", growthDiff), "preview_approved", "page-creating service activation needs approval");
  }

  // --- Hours ordering + range collapsing ---
  {
    const { hoursEntriesForHours } = await import("../lib/generated-site-v3-compiler");
    const scrambled = {
      friday: "8:00am - 5:30pm",
      monday: "8:00am - 5:30pm",
      sunday: "Closed",
      tuesday: "8:00am - 5:30pm",
      saturday: "9:00am - 3:00pm",
      wednesday: "8:00am - 5:30pm",
      thursday: "8:00am - 5:30pm"
    };
    const ordered = hoursEntriesForHours(scrambled);
    assert.deepEqual(
      ordered.map((entry) => entry.label),
      ["Monday \u2013 Friday", "Saturday", "Sunday"],
      "hours must render in week order with consecutive equal days collapsed"
    );
    assert.equal(ordered[0].value, "8:00am - 5:30pm");
    assert.equal(ordered[2].value, "Closed");
    const ranged = hoursEntriesForHours({ "Monday \u2013 Friday": "8am - 5pm", saturday: "9am - 1pm" });
    assert.deepEqual(ranged.map((entry) => entry.label), ["Monday \u2013 Friday", "Saturday"], "pre-ranged labels sort without collapsing");
  }

  // --- Slice 4: live proof resolver guardrails (mock fetch, no network) ---
  {
    const liveProof = await import("../lib/live-proof");
    const originalFetch = globalThis.fetch;
    const originalMode = process.env.LODESTA_LIVE_PROOF_MODE;
    const originalKey = process.env.GOOGLE_PLACES_API_KEY;
    try {
      process.env.LODESTA_LIVE_PROOF_MODE = "google_places";
      process.env.GOOGLE_PLACES_API_KEY = "test_key";

      liveProof.resetLiveProofStateForTests();
      assert.equal(await liveProof.resolveLiveRating(undefined), undefined, "missing place id resolves undefined");

      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ rating: 4.8, userRatingCount: 212 }), { status: 200 })) as typeof fetch;
      liveProof.resetLiveProofStateForTests();
      assert.deepEqual(await liveProof.resolveLiveRating("place_good"), { rating: 4.8, count: 212 });

      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ rating: 3.1, userRatingCount: 40 }), { status: 200 })) as typeof fetch;
      liveProof.resetLiveProofStateForTests();
      assert.equal(await liveProof.resolveLiveRating("place_low"), undefined, "below-threshold ratings are omitted");

      let fetchCalls = 0;
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify({ rating: 4.6, userRatingCount: 50 }), { status: 200 });
      }) as typeof fetch;
      liveProof.resetLiveProofStateForTests();
      await liveProof.resolveLiveRating("place_cached");
      await liveProof.resolveLiveRating("place_cached");
      assert.equal(fetchCalls, 1, "repeat resolutions must hit the cache");

      globalThis.fetch = (async () => {
        fetchCalls += 1;
        throw new Error("network down");
      }) as typeof fetch;
      liveProof.resetLiveProofStateForTests();
      fetchCalls = 0;
      assert.equal(await liveProof.resolveLiveRating("place_a"), undefined, "failures resolve silently undefined");
      assert.equal(await liveProof.resolveLiveRating("place_b"), undefined);
      assert.equal(await liveProof.resolveLiveRating("place_c"), undefined);
      assert.equal(await liveProof.resolveLiveRating("place_d"), undefined, "circuit must be open after repeated failures");
      assert.equal(fetchCalls, 3, "open circuit must not issue further requests");

      process.env.LODESTA_LIVE_PROOF_MODE = "off";
      liveProof.resetLiveProofStateForTests();
      fetchCalls = 0;
      assert.equal(await liveProof.resolveLiveRating("place_off"), undefined, "mode off resolves undefined");
      assert.equal(fetchCalls, 0, "mode off must never fetch");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalMode === undefined) delete process.env.LODESTA_LIVE_PROOF_MODE;
      else process.env.LODESTA_LIVE_PROOF_MODE = originalMode;
      if (originalKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
      else process.env.GOOGLE_PLACES_API_KEY = originalKey;
      liveProof.resetLiveProofStateForTests();
    }
  }

  // --- integration: full generateSite persistence + telemetry (deterministic, no LLM) ---
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENAI_API_KEY = "";

    // Quality-fail path: tire shop with source-backed services but no usable media.
    const failGeneration = await generateSite({
      repository: localRepository,
      input: {
        prompt:
          "Create a website for Verify Tire Shop, a tire shop in Austin. Services: flat repair, used tires, brake service. Phone: (512) 555-0199. Address: 200 Test Road, Austin, TX 78702."
      },
      source: "api",
      modelFallbackPolicy: "allow"
    });
    const failQa = failGeneration.bundle.siteModel.versions[0]?.generationQa;
    assert.equal(failGeneration.generation.vertical, "auto_services");
    assert.equal(failGeneration.generation.status, "blocked", "text-only visual-trade candidate must persist as blocked");
    assert.equal(failQa?.qualityReport?.version, "generation-quality-v2", "quality report must be attached to the persisted candidate");
    assert.ok(
      failQa?.blockers.some((blocker) => blocker.id.startsWith("quality_") || blocker.id.startsWith("scorecard_")),
      `quality enforcement blockers must persist: ${JSON.stringify(failQa?.blockers.map((blocker) => blocker.id))}`
    );
    const storedFail = await localRepository.getSiteCandidate(failGeneration.siteCandidateId);
    assert.equal(storedFail?.status, "blocked", "blocked status must persist in the repository");
    const failRunDetail = await localRepository.getAgentRunDetail(failGeneration.runId);
    const failQaSpan = failRunDetail?.spans.find((span) => span.spanType === "generated_site_qa");
    assert.ok(typeof failQaSpan?.outputJson?.qualityVerdict === "string", "telemetry must record the quality verdict");
    assert.ok(Array.isArray(failQaSpan?.outputJson?.qualityDimensions), "telemetry must record the quality dimension vector");
    assert.ok("repairAttempted" in (failQaSpan?.outputJson ?? {}), "telemetry must record the repair attempt");

    // Quality-pass path: auto body shop with source-backed services and curated media.
    const passGeneration = await generateSite({
      repository: localRepository,
      input: {
        prompt:
          "Create a website for Verify Collision, an auto body shop in Austin. Services: collision repair, paint refinishing, bumper repair, paintless dent repair. Phone: (512) 555-0198. Address: 300 Test Road, Austin, TX 78702."
      },
      source: "api",
      modelFallbackPolicy: "allow"
    });
    const passQa = passGeneration.bundle.siteModel.versions[0]?.generationQa;
    assert.ok(
      (passQa?.qualityReport?.overallScore ?? 0) >= qualityReadyThreshold,
      `quality-pass candidate must clear the threshold, got ${passQa?.qualityReport?.overallScore} (${JSON.stringify(passQa?.qualityReport?.rubric)})`
    );
    assert.ok(
      !passQa?.blockers.some((blocker) => blocker.id.startsWith("quality_")),
      `quality-pass candidate must have no quality blockers: ${JSON.stringify(passQa?.blockers.map((blocker) => blocker.id))}`
    );
    const renderUnavailable = passQa?.blockers.some((blocker) => blocker.id.includes("render_browser_unavailable"));
    if (!renderUnavailable) {
      assert.equal(passGeneration.generation.status, "ready", "quality-passing candidate must persist as ready when render QA can run");
      const storedPass = await localRepository.getSiteCandidate(passGeneration.siteCandidateId);
      assert.equal(storedPass?.status, "ready");
    } else {
      console.log("note: render browser unavailable in this environment; ready-persistence asserted via gate semantics only");
    }
  } finally {
    process.env.OPENAI_API_KEY = previousOpenAiKey;
  }

  // --- Scorecard v2: per-dimension gates, tracked dimensions, no composite authority ---
  {
    const { buildGenerationScorecard, scorecardEnforcementBlockers } = await import("../lib/generation-scorecard");
    const { evaluateSeoStructure } = await import("../lib/seo-structure");

    const empty = buildGenerationScorecard({ blockers: [], warnings: [] });
    const unscored = empty.dimensions.filter((d) => d.state === "unscored");
    assert.ok(unscored.length >= 5, "most dimensions unscored without signals");
    assert.ok(
      unscored.every((d) => d.score === undefined && d.passes === undefined),
      "unscored dimensions carry no score and no pass verdict"
    );

    // Projection from a full quality report + composed version SEO checks.
    const scorecardBundle = createSiteV3FromInput({
      prompt: "Build a website for Scorecard Tire, a tire shop in Austin offering flat repair and new tires. phone: 512-555-0142"
    });
    const compiled = compileGeneratedSiteV3Site({ bundle: scorecardBundle });
    const seo = evaluateSeoStructure({ bundle: scorecardBundle, version: compiled.version });
    assert.ok(seo.score >= 0 && seo.score <= 100, "seo score in range");
    assert.ok(seo.checks.length >= 10, "seo runs full check battery");
    assert.ok(seo.checks.some((check) => check.id === "local_business_jsonld"), "seo includes structured-data check");

    const projected = buildGenerationScorecard({
      qualityReport: {
        version: "generation-quality-v2",
        overallScore: 88,
        craft: 65,
        rubric: {
          verticalFit: 100,
          sourceGrounding: 90,
          serviceClarity: 80,
          heroSpecificity: 85,
          sectionQuality: 75,
          ctaFit: 100,
          mediaCompleteness: 70,
          mobileCredibility: 85
        },
        findings: [],
        evaluatedAt: new Date().toISOString()
      },
      blockers: [],
      warnings: [],
      brandCueApplied: true,
      seoScore: seo.score
    });
    const byId = new Map(projected.dimensions.map((d) => [d.id, d]));
    assert.equal(byId.get("visual_design")?.score, 65, "native 0-100 craft projects directly");
    assert.equal(byId.get("visual_design")?.state, "enforcing", "visual design is required");
    assert.equal(byId.get("seo_structure")?.requirement, "tracked", "seo is tracked but not initially gating");
    assert.equal(typeof byId.get("seo_structure")?.premiumPasses, "boolean", "tracked scored dimensions still report premium pass state");
    assert.equal(byId.get("conversion_readiness")?.passes, true, "ctaFit 100 passes the 70 gate");
    assert.equal(byId.get("correctness_grounding")?.score, 90, "weighted grounding projection");
    assert.equal("overall" in projected, false, "scorecard v2 has no composite overall");
    assert.equal(projected.verdict, "needs_review", "any dimension below premium target becomes needs_review instead of averaged away");

    const premium = buildGenerationScorecard({
      qualityReport: {
        version: "generation-quality-v2",
        overallScore: 100,
        craft: 100,
        rubric: {
          verticalFit: 100,
          sourceGrounding: 100,
          serviceClarity: 100,
          heroSpecificity: 100,
          sectionQuality: 100,
          ctaFit: 100,
          mediaCompleteness: 100,
          mobileCredibility: 100
        },
        findings: [],
        evaluatedAt: new Date().toISOString()
      },
      visualQa: {
        siteId: scorecardBundle.businessProfile.siteId,
        source: "openai",
        model: "test",
        target: "generated_site",
        evaluatedAt: new Date().toISOString(),
        screenshotCount: 3,
        summary: "premium test",
        scoreScale: "visual_qa_score_100_v1",
        score: { craft: 100, overall: 100, brand: 100, layout: 100, copy: 100, conversion: 100, media: 100, mobile: 100 },
        findings: [],
        limitations: []
      },
      blockers: [],
      warnings: [],
      brandCueApplied: true,
      seoScore: 100
    });
    assert.equal(premium.verdict, "premium", "premium requires every scored dimension to clear its 90 target");
    assert.ok(
      premium.dimensions.every((dimension) => dimension.score !== undefined && dimension.premiumPasses === true),
      "premium verdict requires all eight dimensions to be scored and 90+"
    );

    const failing = buildGenerationScorecard({
      qualityReport: {
        version: "generation-quality-v2",
        overallScore: 40,
        rubric: {
          verticalFit: 40,
          sourceGrounding: 30,
          serviceClarity: 40,
          heroSpecificity: 40,
          sectionQuality: 40,
          ctaFit: 30,
          mediaCompleteness: 40,
          mobileCredibility: 40
        },
        findings: [],
        evaluatedAt: new Date().toISOString()
      },
      blockers: [],
      warnings: []
    });
    assert.ok(scorecardEnforcementBlockers(failing).length > 0, "required dimensions below gate convert to blockers");
    assert.equal(failing.verdict, "blocked", "required dimension failure blocks");

    const blockedVisual = buildGenerationScorecard({
      qualityReport: {
        version: "generation-quality-v2",
        overallScore: 95,
        craft: 95,
        rubric: {
          verticalFit: 100,
          sourceGrounding: 100,
          serviceClarity: 100,
          heroSpecificity: 100,
          sectionQuality: 100,
          ctaFit: 100,
          mediaCompleteness: 100,
          mobileCredibility: 100
        },
        findings: [],
        evaluatedAt: new Date().toISOString()
      },
      blockers: [
        {
          id: "section_quality_failure",
          title: "Section failed deterministic QA",
          detail: "Location card overlaps mobile sticky CTA.",
          viewport: "mobile"
        }
      ],
      warnings: []
    });
    const blockedMobile = blockedVisual.dimensions.find((dimension) => dimension.id === "mobile_experience");
    assert.ok((blockedMobile?.score ?? 100) < (blockedMobile?.gate ?? 0), "dimension-internal blocker floors affected dimension");
    console.log("scorecard v2 checks passed");
  }

  // --- Design controls + profiles (slice 2) ---
  {
    const { resolveDesignControlsV3, validateDesignControlsV3 } = await import("../lib/generated-site-v3-art-direction-catalog");

    // Resolution is deterministic and total over the profile space.
    const registers = ["punchy_retail", "steady_professional", "warm_boutique"] as const;
    const postures = ["accent_forward", "reserved"] as const;
    for (const register of registers) {
      for (const brandPosture of postures) {
        const first = resolveDesignControlsV3({ register, brandPosture });
        const second = resolveDesignControlsV3({ register, brandPosture });
        assert.deepEqual(first, second, `resolution deterministic for ${register}/${brandPosture}`);
        const violations = validateDesignControlsV3(first, { headerMode: "solid_editorial" });
        assert.equal(violations.length, 0, `profile ${register}/${brandPosture} resolves to a compatible control set: ${violations.join("; ")}`);
      }
    }

    // Incompatibility table catches known-bad combos.
    const bad = validateDesignControlsV3(
      { ...resolveDesignControlsV3({ register: "punchy_retail", brandPosture: "accent_forward" }) },
      { headerMode: "transparent_overlay" }
    );
    assert.ok(bad.length > 0, "brand_bar on transparent header is rejected");

    // Compiled versions store BOTH layers (reproducibility rule).
    const controlsBundle = createSiteV3FromInput({
      prompt: "Build a website for Controls Tire, a tire shop in Austin offering flat repair and new tires. phone: 512-555-0177"
    });
    const compiledControls = compileGeneratedSiteV3Site({ bundle: controlsBundle });
    assert.ok(compiledControls.version.artDirection.designProfile, "version stores the design profile (learning layer)");
    assert.ok(compiledControls.version.artDirection.controls, "version stores resolved controls (rendering authority)");
    assert.equal(
      compiledControls.version.artDirection.designProfile?.register,
      "punchy_retail",
      "auto vertical selects the retail register"
    );
    console.log("design controls slice 2 checks passed");
  }

  // --- Fact coverage Phase A (slice 3) ---
  {
    const { buildFactCoverageReport } = await import("../lib/fact-coverage");
    const coverageBundle = createSiteV3FromInput({
      prompt:
        "Build a website for Coverage Tire, a tire shop in Austin offering flat repair, new tires, and wheel alignment. phone: 512-555-0161. address: 100 Coverage Rd, Austin, TX"
    });
    const compiledCoverage = compileGeneratedSiteV3Site({ bundle: coverageBundle });
    const report = buildFactCoverageReport({ bundle: coverageBundle, version: compiledCoverage.version });

    assert.ok(report.facts.length >= 3, "coverage report classifies the core facts");
    assert.ok(report.eligibleCount >= report.surfacedCount, "eligible denominator bounds surfaced");
    const services = report.facts.find((fact) => fact.category === "services");
    assert.equal(services?.state, "surfaced", "services render and report surfaced");
    assert.ok(
      report.facts.every((fact) => fact.sourceClass !== "inferred" || (!fact.renderable && fact.state === "blocked_by_policy")),
      "inferred facts are non-renderable by default"
    );
    assert.ok(typeof report.coverageRatio === "number" && report.coverageRatio > 0 && report.coverageRatio <= 1, "coverage ratio in range");

    // End-to-end: readiness attaches scorecard + coverage to QA metadata.
    const e2e = await generateSite({
      repository: localRepository,
      input: {
        prompt:
          "Create a website for Coverage Collision, an auto body shop in Austin. Services: collision repair, paint refinishing, bumper repair, paintless dent repair. Phone: (512) 555-0162. Address: 410 Coverage Road, Austin, TX 78702."
      },
      source: "api",
      modelFallbackPolicy: "allow"
    });
    const e2eQa = e2e.bundle.siteModel.versions[0]?.generationQa;
    assert.ok(e2eQa?.scorecard, "generated candidates carry the scorecard");
    assert.ok(e2eQa?.factCoverage, "generated candidates carry the fact-coverage report");
    assert.ok(
      e2eQa?.scorecard?.dimensions.find((d) => d.id === "seo_structure")?.requirement === "tracked",
      "seo dimension is tracked in the live pipeline"
    );
    console.log("fact coverage slice 3 checks passed");
  }

  // --- Shadow craft loop Tier-1 (slice 4) ---
  {
    const { runShadowCraftLoop, applyMutation } = await import("../lib/craft-loop");

    // Off by default.
    const loopBundle = createSiteV3FromInput({
      prompt: "Build a website for Loop Tire, a tire shop in Austin offering flat repair and new tires. phone: 512-555-0151"
    });
    const compiledLoop = compileGeneratedSiteV3Site({ bundle: loopBundle });
    const qaStub = { readiness: "ready" as const, blockers: [], warnings: [] };
    assert.equal(
      await runShadowCraftLoop({ bundle: loopBundle, version: compiledLoop.version, qa: qaStub }),
      undefined,
      "craft loop is inert without LODESTA_CRAFT_LOOP=shadow"
    );

    const previousLoopEnv = process.env.LODESTA_CRAFT_LOOP;
    process.env.LODESTA_CRAFT_LOOP = "shadow";
    try {
      // Repair guard inherited: owner-touched versions are never mutated.
      const touched = { ...structuredClone(compiledLoop.version), ownerTouched: true };
      const guarded = await runShadowCraftLoop({ bundle: loopBundle, version: touched, qa: qaStub });
      assert.ok(guarded?.skipped?.includes("guard"), "owner-touched versions skip the loop");

      // Without an API key the critic proposes nothing; the loop records cleanly.
      const ran = await runShadowCraftLoop({ bundle: loopBundle, version: compiledLoop.version, qa: qaStub });
      assert.equal(ran?.mode, "shadow");
      assert.equal(ran?.iterations.length, 0, "no critic, no iterations");

      // Mutation mechanics: valid control change applies; invalid is rejected;
      // incompatible combos are refused; oscillation is detected.
      const artDirection = structuredClone(compiledLoop.version.artDirection) as unknown as Record<string, unknown>;
      const ok = applyMutation(artDirection, {
        action: "adjust_profile_control",
        target: "cardChrome",
        value: "elevated",
        rationale: "test",
        expectedDimension: "visual_design"
      }, []);
      assert.equal(ok.applied, true, "valid control mutation applies");
      const bad = applyMutation(artDirection, {
        action: "adjust_profile_control",
        target: "cardChrome",
        value: "neon_glow",
        rationale: "test",
        expectedDimension: "visual_design"
      }, []);
      assert.equal(bad.applied, false, "unknown control value rejected");
      const heroChange = applyMutation(artDirection, {
        action: "change_hero_variant",
        target: "hero",
        value: "hero_statement",
        rationale: "test",
        expectedDimension: "visual_design"
      }, []);
      assert.equal(heroChange.applied, false, "hero variant is tier-gated at the default tier");
      assert.ok(heroChange.note.includes("tier_gated"));
      const oscillating = applyMutation(artDirection, {
        action: "adjust_profile_control",
        target: "cardChrome",
        value: String(ok.before),
        rationale: "test",
        expectedDimension: "visual_design"
      }, [ok]);
      assert.equal(oscillating.applied, false, "reverting mutation detected as oscillation");
      const swap = applyMutation(artDirection, {
        action: "swap_presentation",
        target: "services",
        value: "card_grid",
        rationale: "test",
        expectedDimension: "visual_design"
      }, []);
      assert.equal(swap.applied, true, "compatible presentation swap applies");
      const badSwap = applyMutation(artDirection, {
        action: "swap_presentation",
        target: "process",
        value: "card_grid",
        rationale: "test",
        expectedDimension: "visual_design"
      }, []);
      assert.equal(badSwap.applied, false, "role-incompatible presentation rejected");
    } finally {
      if (previousLoopEnv === undefined) delete process.env.LODESTA_CRAFT_LOOP;
      else process.env.LODESTA_CRAFT_LOOP = previousLoopEnv;
    }
    console.log("craft loop slice 4 checks passed");
  }

  // --- Model design brief (Part 2.4) ---
  {
    const { createDesignBrief, resolveBrief } = await import("../lib/design-brief-v1");
    const { resolveDesignControlsV3 } = await import("../lib/generated-site-v3-art-direction-catalog");

    // No API key → no brief; the compiler's deterministic tier carries.
    const briefBundle = createSiteV3FromInput({
      prompt: "Build a website for Brief Tire, a tire shop in Austin offering flat repair and new tires. phone: 512-555-0188"
    });
    assert.equal(
      await createDesignBrief({ business: briefBundle.businessProfile, brandApplied: true }),
      undefined,
      "brief is absent without a model key"
    );

    // Valid overrides merge; incompatible override sets fall back to pure profile.
    const profile = { register: "punchy_retail" as const, brandPosture: "reserved" as const };
    const base = resolveDesignControlsV3(profile);
    const merged = resolveBrief(profile, { cardChrome: "elevated" }, "solid_editorial");
    assert.equal(merged.cardChrome, "elevated", "valid override applies");
    assert.equal(merged.eyebrowTreatment, base.eyebrowTreatment, "non-overridden controls keep profile values");
    const incompatible = resolveBrief(
      { register: "steady_professional", brandPosture: "reserved" },
      { headingCase: "display_upper" },
      "solid_editorial"
    );
    assert.deepEqual(
      incompatible,
      resolveDesignControlsV3({ register: "steady_professional", brandPosture: "reserved" }),
      "override tripping the incompatibility table (display_upper + plain_caps) falls back to profile resolution"
    );

    // Compiled version consumes a bundle-level brief.
    briefBundle.presenceAssessment.designBrief = {
      profile: { register: "warm_boutique", brandPosture: "reserved", rationale: "test brief" },
      overrides: { badgeStyle: "rounded" },
      source: "model"
    };
    const briefCompiled = compileGeneratedSiteV3Site({ bundle: briefBundle });
    assert.equal(briefCompiled.version.artDirection.designProfile?.register, "warm_boutique", "brief profile wins over deterministic");
    assert.equal(briefCompiled.version.artDirection.controls?.badgeStyle, "rounded", "brief override survives compile");
    console.log("design brief checks passed");
  }

  // --- Craft loop Tier-2/3 (recompile path + content mutations) ---
  {
    const { applyMutation } = await import("../lib/craft-loop");
    const { compileGeneratedSiteV3Site: compileForOverrides } = await import("../lib/generated-site-v3-compiler");

    const tierBundle = createSiteV3FromInput({
      prompt: "Build a website for Tier Tire, a tire shop in Austin offering flat repair, new tires, and wheel alignment. phone: 512-555-0199"
    });
    tierBundle.businessProfile.photos = Array.from({ length: 4 }, (_, index) => ({
      id: `tier_photo_${index + 1}`,
      url: `/generated-site-assets/auto-body/${["lift-bay-overview-v1.png", "finished-shop-review-v1.png", "windshield-replacement-v1.png", "paint-prep-sanding-block-v1.png"][index]}`,
      alt: `photo ${index + 1}`,
      source: "generated" as const,
      rightsStatus: "preclaim_safe" as const
    }));

    // Tier gating: Tier-2+ actions refuse to apply at the default tier.
    const previousTiers = process.env.LODESTA_CRAFT_LOOP_TIERS;
    delete process.env.LODESTA_CRAFT_LOOP_TIERS;
    const gated = applyMutation({}, {
      action: "change_hero_variant",
      target: "hero",
      value: "image_statement",
      rationale: "test",
      expectedDimension: "visual_design"
    }, []);
    assert.equal(gated.applied, false, "tier-2 action gated at default tier");
    assert.ok(gated.note.includes("tier_gated"));

    process.env.LODESTA_CRAFT_LOOP_TIERS = "3";
    try {
      const heroReq = applyMutation({}, {
        action: "change_hero_variant",
        target: "hero",
        value: "image_statement",
        rationale: "test",
        expectedDimension: "visual_design"
      }, []);
      assert.equal(heroReq.applied, true, "tier-2 hero request accepted at tier 3");
      assert.equal(heroReq.note, "recompile_request");

      // Compiler overrides: explicit variant beats seed; preconditions enforced.
      const forcedImage = compileForOverrides({ bundle: structuredClone(tierBundle), overrides: { heroVariant: "image_statement" } });
      const heroImage = forcedImage.version.pageComposition.pages[0].sections[0];
      const imageVisual = (heroImage.props as { visualSectionV3?: { templateId: string; options?: { background?: { kind?: string } } } }).visualSectionV3;
      assert.equal(imageVisual?.templateId, "hero_statement", "override forces image hero");
      assert.equal(imageVisual?.options?.background?.kind, "image", "image hero carries image background");

      const forcedSplit = compileForOverrides({ bundle: structuredClone(tierBundle), overrides: { heroVariant: "hero_split" } });
      const splitVisual = (forcedSplit.version.pageComposition.pages[0].sections[0].props as { visualSectionV3?: { templateId: string } }).visualSectionV3;
      assert.equal(splitVisual?.templateId, "hero_split", "override forces split hero");

      // Media override precondition: arbitrary URLs are ignored.
      const arbitrary = compileForOverrides({
        bundle: structuredClone(tierBundle),
        overrides: { heroVariant: "image_statement", heroMediaUrl: "https://evil.example/injected.jpg" }
      });
      const arbitraryVisual = (arbitrary.version.pageComposition.pages[0].sections[0].props as { visualSectionV3?: { options?: { background?: { url?: string } } } }).visualSectionV3;
      assert.ok(
        arbitraryVisual?.options?.background?.url?.startsWith("/generated-site-assets/"),
        "non-gallery media override ignored; safe asset retained"
      );
    } finally {
      if (previousTiers === undefined) delete process.env.LODESTA_CRAFT_LOOP_TIERS;
      else process.env.LODESTA_CRAFT_LOOP_TIERS = previousTiers;
    }
    console.log("craft loop tier 2/3 checks passed");
  }

  // --- fingerprintV1 ---
  {
    const { computeFingerprintV1, fingerprintDistanceV1, minPairwiseDistanceV1 } = await import("../lib/fingerprint-v1");
    const fpBundleA = createSiteV3FromInput({
      prompt: "Build a website for Fp Tire One, a tire shop in Austin offering flat repair and new tires. phone: 512-555-0301"
    });
    const fpBundleB = createSiteV3FromInput({
      prompt: "Build a website for Fp Salon Two, a beauty salon in Austin offering haircuts, color, and styling. phone: 512-555-0302"
    });
    const fpA = computeFingerprintV1(compileGeneratedSiteV3Site({ bundle: fpBundleA }).version);
    const fpA2 = computeFingerprintV1(compileGeneratedSiteV3Site({ bundle: structuredClone(fpBundleA) }).version);
    const fpB = computeFingerprintV1(compileGeneratedSiteV3Site({ bundle: fpBundleB }).version);
    assert.equal(fingerprintDistanceV1(fpA, fpA2), 0, "same input → identical fingerprint, distance 0");
    assert.ok(fingerprintDistanceV1(fpA, fpB) > 25, "cross-vertical compiles are distinct");
    assert.equal(minPairwiseDistanceV1([fpA]), undefined, "single fingerprint has no pairwise distance");
    console.log("fingerprint v1 checks passed");
  }

  console.log("verify-generation-quality-v2: all checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
