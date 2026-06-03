import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SiteBundle, SiteModel } from "../lib/models";
import {
  autoBodyPlaybookV2,
  autoBodySectionContractsV2,
  claimIdV2,
  deriveGenerationQaReadinessV2,
  generatedSiteV2SectionContracts,
  getGeneratedSiteV2Mode,
  googlePlaceLinkAction,
  homeServicesPlaybookV2,
  homeServicesSectionContractsV2,
  isGeneratedSiteV2Allowed,
  normalizeClaimTextV2,
  restaurantPlaybookV2,
  restaurantSectionContractsV2
} from "../lib/generated-site-v2";
import { blockersFromSiteModel } from "../lib/generated-site-qa";
import { runAssetSelectionV2 } from "../lib/asset-selection-v2";
import { runBrandDirectionV2 } from "../lib/brand-direction-v2";
import { runBrandMarkGenerationGateV2 } from "../lib/brand-mark-generation-v2";
import { runBusinessContextRefreshV2 } from "../lib/business-context-refresh-v2";
import { runBusinessIdentityServiceAuditV2 } from "../lib/business-identity-service-v2";
import { runClaimVerificationReportV2 } from "../lib/claim-report-v2";
import {
  clearFlowHomeServicesBusinessV2,
  createClearFlowHomeServicesV2FixtureVersion,
  createNorthLoopTacosV2FixtureVersion,
  createSuperBAutoBodyV2FixtureVersion,
  northLoopTacosBusinessV2,
  superBAutoBodyBusinessV2,
  superBAutoBodyFactsV2
} from "../lib/generated-site-v2-fixture";
import { createLocalBusinessCopyArtifactV2 } from "../lib/copy-local-business-marketing";
import { runCopyRefreshAuditV2 } from "../lib/copy-refresh-audit-v2";
import { runDesignSectionAuditsV2 } from "../lib/design-section-audits-v2";
import { proposeCopyArtifactDiffsV2 } from "../lib/generated-site-v2-diffs";
import { compileAutoBodyV2Site } from "../lib/generated-site-v2-compiler";
import { runOptimizationReportsAuditV2 } from "../lib/optimization-reports-v2";
import { runPageOpportunitiesAuditV2 } from "../lib/page-opportunities-v2";
import { runPolicyReportV2 } from "../lib/policy-report-v2";
import { runPerformanceAuditV2 } from "../lib/performance-audit-v2";
import { runRegulatedClaimsPolicyV2 } from "../lib/regulated-claims-policy-v2";
import { runSeoMetadataAuditV2 } from "../lib/seo-metadata-v2";
import { runLocalLandingPagesAuditV2 } from "../lib/seo-local-landing-pages-v2";
import { runSocialProofAuditV2 } from "../lib/social-proof-v2";
import { runStrategyPlanningAuditV2 } from "../lib/strategy-planning-v2";
import { runVisualQualityAuditV2 } from "../lib/visual-quality-audit-v2";
import { markdownForPage } from "../lib/public-site-markdown";
import { placeToPublicPresenceEnrichment } from "../lib/public-presence";
import { localRepository } from "../lib/repository";
import { SiteRenderer } from "../lib/site-renderer";
import { resolveSkillPacksV2 } from "../lib/skill-registry-v2";
import { generateSite } from "../lib/site-generation-service";

const defaultV2Mode = getGeneratedSiteV2Mode({ GENERATED_SITE_V2_MODE: "bad" } as unknown as NodeJS.ProcessEnv);
assert.equal(defaultV2Mode, "all_canonical");
assert.equal(isGeneratedSiteV2Allowed({ mode: defaultV2Mode, vertical: "auto_body" }), true);
assert.equal(isGeneratedSiteV2Allowed({ mode: defaultV2Mode, vertical: "restaurant" }), true);
assert.equal(isGeneratedSiteV2Allowed({ mode: defaultV2Mode, vertical: "home_services" }), true);
assert.equal(isGeneratedSiteV2Allowed({ mode: defaultV2Mode, vertical: "law_firm" }), true);
assert.equal(isGeneratedSiteV2Allowed({ mode: "fixture_only", fixture: true }), true);
assert.equal(isGeneratedSiteV2Allowed({ mode: "fixture_only", vertical: "auto_body" }), false);
assert.equal(isGeneratedSiteV2Allowed({ mode: "operator_allowlist", explicitOperatorRequest: true, sourceHost: "superb.example", allowlistHosts: ["superb.example"] }), true);
assert.equal(isGeneratedSiteV2Allowed({ mode: "auto_body_canonical", vertical: "auto_body" }), true);
assert.equal(isGeneratedSiteV2Allowed({ mode: "auto_body_canonical", vertical: "restaurant" }), false);
assert.equal(isGeneratedSiteV2Allowed({ mode: "supported_verticals_canonical", vertical: "auto_body" }), true);
assert.equal(isGeneratedSiteV2Allowed({ mode: "supported_verticals_canonical", vertical: "restaurant" }), true);
assert.equal(isGeneratedSiteV2Allowed({ mode: "supported_verticals_canonical", vertical: "home_services" }), true);
assert.equal(isGeneratedSiteV2Allowed({ mode: "supported_verticals_canonical", vertical: "law_firm" }), false);
assert.equal(isGeneratedSiteV2Allowed({ mode: "all_canonical", vertical: "law_firm" }), true);
assert.deepEqual(
  resolveSkillPacksV2({ context: { vertical: "auto_body" } }).map((skill) => skill.id),
  ["copy.local-business-marketing"]
);
assert.deepEqual(
  resolveSkillPacksV2({
    context: {
      vertical: "auto_body",
      explicitSkillIds: [
        "optimization.copy-refresh",
        "strategy.page-opportunities",
        "strategy.vertical-classifier",
        "strategy.conversion-path",
        "strategy.information-architecture",
        "business.context-refresh",
        "business.identity-reconcile",
        "business.service-catalog",
        "business.change-impact",
        "brand.cue-extraction",
        "brand.direction",
        "brand.mark-generation",
        "asset.selection",
        "seo.metadata",
        "seo.local-landing-pages",
        "claims.verification",
        "policy.google-places",
        "policy.regulated-claims",
        "optimization.performance-audit",
        "proof.social-proof",
        "optimization.conversion-insights",
        "optimization.local-seo-refresh",
        "optimization.page-gap-analysis",
        "optimization.experiment-recommendations",
        "design.site-system",
        "design.header-system",
        "design.section-composition",
        "section.service-matrix",
        "section.proof-review",
        "section.contact-location-hours",
        "design.visual-quality-audit"
      ]
    }
  }).map((skill) => skill.id),
  [
    "optimization.copy-refresh",
    "strategy.page-opportunities",
    "strategy.vertical-classifier",
    "strategy.conversion-path",
    "strategy.information-architecture",
    "business.context-refresh",
    "business.identity-reconcile",
    "business.service-catalog",
    "business.change-impact",
    "brand.cue-extraction",
    "brand.direction",
    "brand.mark-generation",
    "asset.selection",
    "seo.metadata",
    "seo.local-landing-pages",
    "claims.verification",
    "policy.google-places",
    "policy.regulated-claims",
    "optimization.performance-audit",
    "proof.social-proof",
    "optimization.conversion-insights",
    "optimization.local-seo-refresh",
    "optimization.page-gap-analysis",
    "optimization.experiment-recommendations",
    "design.site-system",
    "design.header-system",
    "design.section-composition",
    "section.service-matrix",
    "section.proof-review",
    "section.contact-location-hours",
    "design.visual-quality-audit",
    "copy.local-business-marketing"
  ]
);

assert.equal(deriveGenerationQaReadinessV2({ blockers: [], checked: false }), "pending");
assert.equal(deriveGenerationQaReadinessV2({ blockers: [], checked: true, unavailable: true }), "unavailable");
assert.equal(deriveGenerationQaReadinessV2({ blockers: [], checked: true }), "ready");
assert.equal(
  deriveGenerationQaReadinessV2({
    checked: true,
    blockers: [{ id: "x", title: "X", detail: "X", severity: "warning" }]
  }),
  "ready"
);
assert.equal(
  deriveGenerationQaReadinessV2({
    checked: true,
    blockers: [{ id: "x", title: "X", detail: "X" }]
  }),
  "blocked"
);

assert.equal(normalizeClaimTextV2("  Super B Paint & Body.  "), "super b paint & body");
assert.equal(
  claimIdV2({ sourceFactIds: ["fact_b", "fact_a"], category: "service", normalizedClaimValue: "Collision repair" }),
  claimIdV2({ sourceFactIds: ["fact_a", "fact_b"], category: "service", normalizedClaimValue: " collision repair. " })
);

assert.equal(autoBodyPlaybookV2.id, "auto_body");
assert.ok(autoBodySectionContractsV2.some((contract) => contract.id === "hero.estimate_intake"));
assert.ok(autoBodySectionContractsV2.some((contract) => contract.id === "contact.location_hours" && contract.requiredFactKinds.includes("address")));
assert.equal(restaurantPlaybookV2.id, "restaurant");
assert.ok(restaurantSectionContractsV2.some((contract) => contract.id === "hero.order_path"));
assert.ok(restaurantSectionContractsV2.some((contract) => contract.id === "menu.highlights"));
assert.equal(homeServicesPlaybookV2.id, "home_services");
assert.ok(homeServicesSectionContractsV2.some((contract) => contract.id === "hero.service_request"));
assert.ok(homeServicesSectionContractsV2.some((contract) => contract.id === "coverage.service_area"));

for (const fixture of [
  {
    id: "auto_body",
    vertical: superBAutoBodyBusinessV2.vertical,
    version: createSuperBAutoBodyV2FixtureVersion().version
  },
  {
    id: "restaurant",
    vertical: northLoopTacosBusinessV2.vertical,
    version: createNorthLoopTacosV2FixtureVersion().version
  },
  {
    id: "home_services",
    vertical: clearFlowHomeServicesBusinessV2.vertical,
    version: createClearFlowHomeServicesV2FixtureVersion().version
  }
]) {
  for (const page of fixture.version.compiledPages) {
    for (const section of page.sections) {
      const contract = generatedSiteV2SectionContracts.find((candidate) =>
        candidate.id === section.family &&
        candidate.verticals.includes(fixture.vertical)
      );
      assert.ok(
        contract,
        `${fixture.id}:${page.slug || "home"}:${section.id} missing horizontal section contract for ${section.family}`
      );
      assert.ok(
        contract.layoutVariants.includes(section.variant),
        `${fixture.id}:${page.slug || "home"}:${section.id} uses uncontracted variant ${section.family}/${section.variant}`
      );
    }
  }
}

const googleAction = googlePlaceLinkAction({ siteId: "site_123", placeId: "places_abc123", source: "proof" });
assert.ok(googleAction.startsWith("/api/places/google-link?"));
assert.equal(googleAction.includes("google.com"), false);

const enrichment = placeToPublicPresenceEnrichment(
  {
    id: "places/superb",
    displayName: { text: "Super B Paint and Body" },
    rating: 4.8,
    userRatingCount: 312,
    googleMapsUri: "https://maps.google.example/not-stored",
    nationalPhoneNumber: "(555) 123-4567",
    formattedAddress: "1 Main St, Dallas, TX 75201",
    regularOpeningHours: { weekdayDescriptions: ["Monday: 8:00 AM - 5:00 PM"] }
  },
  {
    url: "https://superb.example",
    crawl: {
      url: "https://superb.example",
      fetched: true,
      status: 200,
      title: "Super B",
      metaDescription: "",
      hasViewportMeta: true,
      hasLocalBusinessSchema: false,
      hasTelLink: true,
      robotsFound: true,
      sitemapFound: true,
      formCount: 0,
      imageCount: 0,
      imagesWithoutAlt: 0,
      internalLinkCount: 0,
      externalLinkCount: 0,
      jsonLdTypes: [],
      extractedFacts: {
        name: "Super B Paint and Body",
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
      assetReferences: [],
      sampledInternalPages: [],
      pageSummaries: [],
      score: { overall: 0, max: 0, percent: 0, grade: "needs_work", checks: [] },
      findings: [],
      finalUrl: "https://superb.example"
    }
  },
  "Super B Paint and Body",
  "2026-06-01T00:00:00.000Z"
);
assert.equal(enrichment.facts.reviewsSummary, undefined);
assert.equal(enrichment.signals[0]?.fields.rating, undefined);
assert.equal(enrichment.signals[0]?.fields.userRatingCount, undefined);
assert.equal(enrichment.signals[0]?.fields.googleMapsUri, undefined);
assert.equal(enrichment.signals[0]?.sourceUrl, undefined);

const { version, copyArtifacts } = createSuperBAutoBodyV2FixtureVersion();
assert.equal(version.rendererVersion, "layout-v2");
assert.equal(version.designSchemaVersion, "design-v2");
assert.equal(version.compiledPages[0]?.sections[0]?.family, "hero.estimate_intake");
assert.ok(version.artifactRefs.some((artifact) => artifact.artifactType === "copy_artifact"));
assert.ok(version.artifactRefs.every((artifact) => artifact.affectedPageId && artifact.affectedSectionId && artifact.affectedSlotId));
const refreshedHeroCopy = createLocalBusinessCopyArtifactV2({
  slotId: copyArtifacts[0]!.slotId,
  text: `${copyArtifacts[0]!.text} with a clearer first call.`,
  category: "business_identity",
  factIds: copyArtifacts[0]!.claimSpans.flatMap((span) => span.sourceFactIds),
  verticalPlaybookVersion: copyArtifacts[0]!.verticalPlaybookVersion,
  sectionContractVersion: copyArtifacts[0]!.sectionContractVersion,
  status: "candidate"
});
const copyDiffs = proposeCopyArtifactDiffsV2({ version, candidateArtifacts: [refreshedHeroCopy] });
assert.equal(copyDiffs[0]?.status, "proposed");
assert.equal(copyDiffs[0]?.targetSlotId, copyArtifacts[0]!.slotId);
assert.ok(copyDiffs[0]?.targetSectionId);
const rejectedCopyDiff = proposeCopyArtifactDiffsV2({
  version,
  candidateArtifacts: [{ ...refreshedHeroCopy, id: `${refreshedHeroCopy.id}_rejected`, status: "rejected" }]
});
assert.equal(rejectedCopyDiff[0]?.status, "blocked");
const storedArtifact = await localRepository.upsertGenerationArtifact({
  id: "artifact_v2_contract_fixture",
  generationId: "sitegen_v2_contract_fixture",
  scope: "generation_selected",
  artifactType: "copy_artifact",
  artifactVersion: copyArtifacts[0]!.artifactVersion,
  producerId: copyArtifacts[0]!.producerId,
  producerVersion: copyArtifacts[0]!.producerVersion,
  verticalPlaybookVersion: copyArtifacts[0]!.verticalPlaybookVersion,
  sectionContractVersion: copyArtifacts[0]!.sectionContractVersion,
  sourceFactIds: copyArtifacts[0]!.claimSpans.flatMap((span) => span.sourceFactIds),
  affectedSlotId: copyArtifacts[0]!.slotId,
  contentHash: version.artifactRefs[0]!.contentHash,
  payload: { text: copyArtifacts[0]!.text },
  createdAt: "2026-06-01T00:00:00.000Z"
});
assert.equal(storedArtifact.artifactType, "copy_artifact");
const storedArtifacts = await localRepository.listGenerationArtifacts({ generationId: "sitegen_v2_contract_fixture" });
assert.equal(storedArtifacts.length, 1);

const site: SiteModel = {
  id: superBAutoBodyBusinessV2.siteId,
  slug: "super-b-v2-fixture",
  theme: {
    paletteName: "fixture",
    colors: {
      background: "#fff",
      surface: "#fff",
      text: "#111",
      muted: "#666",
      primary: "#b21f2d",
      primaryText: "#fff",
      accent: "#f0b429",
      border: "#ddd"
    },
    typography: { heading: "system-ui", body: "system-ui" },
    radius: "sm",
    density: "standard",
    mood: "bold"
  },
  versions: [version],
  pinList: []
};
assert.deepEqual(blockersFromSiteModel(fixtureBundle(), version), []);

const html = renderToStaticMarkup(
  React.createElement(SiteRenderer, {
    business: superBAutoBodyBusinessV2,
    site,
    extensions: { forms: [], workflows: [], customBlocks: [] },
    version,
    tracking: false,
    formsEnabled: false
  })
);
assert.ok(html.includes("public-site-v2"));
assert.ok(html.includes("site-header-v2"));
assert.equal(html.includes("button primary"), false);
assert.equal(html.includes("4.8"), false);
assert.equal(html.includes("312"), false);

const assetBusiness = structuredClone(superBAutoBodyBusinessV2);
assetBusiness.logo = {
  id: "logo_safe",
  url: "https://cdn.example/logo.png",
  alt: "Super B logo",
  source: "uploaded",
  rightsStatus: "customer_granted"
};
assetBusiness.photos = [
  {
    id: "photo_reference",
    url: "https://cdn.example/reference-only.jpg",
    alt: "Reference only",
    source: "website_reference",
    rightsStatus: "reference_only"
  },
  {
    id: "photo_safe",
    url: "https://cdn.example/shop.jpg",
    alt: "Repair shop",
    source: "uploaded",
    rightsStatus: "customer_granted"
  }
];
const assetVersion = compileAutoBodyV2Site({
  siteId: assetBusiness.siteId,
  business: assetBusiness,
  sourceFacts: superBAutoBodyFactsV2,
  createdAt: "2026-06-01T00:00:00.000Z"
}).version;
const assetServicePage = assetVersion.compiledPages.find((page) => page.slug === "services/collision-repair");
assert.ok(assetServicePage, "V2 auto-body compile should create a collision repair service page.");
assert.ok(
  assetVersion.pages.some((page) => page.slug === assetServicePage.slug && page.seo.canonicalPath === "/services/collision-repair"),
  "Compiled service pages should project into legacy page metadata for public routes, sitemap, and markdown."
);
assert.ok(
  assetVersion.blueprint.pages.some((page) => page.slug === assetServicePage.slug),
  "Compiled service pages should appear in the V2 blueprint."
);
assert.ok(
  assetVersion.artifactRefs.some((artifact) => artifact.affectedPageId === assetServicePage.id),
  "Service-page copy artifacts should keep page-level provenance."
);
const assetSite = { ...site, versions: [assetVersion] };
const assetHtml = renderToStaticMarkup(
  React.createElement(SiteRenderer, {
    business: assetBusiness,
    site: assetSite,
    extensions: { forms: [], workflows: [], customBlocks: [] },
    version: assetVersion,
    tracking: false,
    formsEnabled: false
  })
);
assert.ok(assetHtml.includes("https://cdn.example/logo.png"));
assert.ok(assetHtml.includes("https://cdn.example/shop.jpg"));
assert.equal(assetHtml.includes("reference-only.jpg"), false);
assert.ok(assetHtml.includes("/sites/super-b-v2-fixture/services/collision-repair"));
const assetServiceProjection = assetVersion.pages.find((page) => page.slug === assetServicePage.slug);
assert.ok(assetServiceProjection);
const assetBundleForMarkdown: SiteBundle = {
  businessProfile: assetBusiness,
  siteModel: assetSite,
  extensionModel: { forms: [], workflows: [], customBlocks: [] },
  optimizationFindings: [],
  experiments: [],
  presenceAssessment: {
    siteId: assetBusiness.siteId,
    technicalNotes: [],
    visualNotes: [],
    brandNotes: [],
    publicPresenceNotes: []
  }
};
const serviceMarkdown = markdownForPage(assetBundleForMarkdown, assetServiceProjection, new Headers({ host: "localhost:4330" }));
assert.ok(serviceMarkdown.includes("# Collision repair"));
assert.ok(serviceMarkdown.includes("## Collision repair for visible body damage"));
assert.ok(serviceMarkdown.includes("## How to start"));
const assetSelectionAudit = runAssetSelectionV2({
  bundle: {
    businessProfile: assetBusiness,
    siteModel: { ...site, versions: [assetVersion] },
    extensionModel: { forms: [], workflows: [], customBlocks: [] },
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: assetBusiness.siteId,
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  },
  version: assetVersion,
  siteId: assetBusiness.siteId,
  createdAt: "2026-06-01T00:00:00.000Z"
});
assert.equal(assetSelectionAudit.selections.find((selection) => selection.slotId === "heroMedia")?.assetId, "photo_safe");
assert.equal(assetSelectionAudit.selections.find((selection) => selection.slotId === "brandMark")?.assetId, "logo_safe");
assert.equal(assetSelectionAudit.artifact.artifactType, "asset_selection_report");
const seoMetadataAudit = runSeoMetadataAuditV2({
  bundle: {
    businessProfile: assetBusiness,
    siteModel: { ...site, versions: [assetVersion] },
    extensionModel: { forms: [], workflows: [], customBlocks: [] },
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: assetBusiness.siteId,
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  },
  version: assetVersion,
  siteId: assetBusiness.siteId,
  createdAt: "2026-06-01T00:00:00.000Z"
});
assert.equal(seoMetadataAudit.artifact.artifactType, "seo_metadata_report");
assert.equal(seoMetadataAudit.scorecard.blockingIssues, 0);
assert.ok(seoMetadataAudit.issues.some((issue) => issue.id.startsWith("title_includes_business") && issue.severity === "pass"));
const claimReport = runClaimVerificationReportV2({
  bundle: {
    businessProfile: assetBusiness,
    siteModel: { ...site, versions: [assetVersion] },
    extensionModel: { forms: [], workflows: [], customBlocks: [] },
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: assetBusiness.siteId,
      businessFactGraph: {
        id: "factgraph_claim_report_fixture",
        siteId: assetBusiness.siteId,
        createdAt: "2026-06-01T00:00:00.000Z",
        sources: [],
        facts: [],
        omittedFacts: [],
        sourceFactsV2: superBAutoBodyFactsV2
      },
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  },
  version: assetVersion,
  siteId: assetBusiness.siteId,
  createdAt: "2026-06-01T00:00:00.000Z"
});
assert.equal(claimReport.artifact.artifactType, "claim_report");
assert.equal(claimReport.status, "passed");
const policyReport = runPolicyReportV2({
  bundle: {
    businessProfile: assetBusiness,
    siteModel: { ...site, versions: [assetVersion] },
    extensionModel: { forms: [], workflows: [], customBlocks: [] },
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: assetBusiness.siteId,
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  },
  version: assetVersion,
  siteId: assetBusiness.siteId,
  createdAt: "2026-06-01T00:00:00.000Z"
});
assert.equal(policyReport.artifact.artifactType, "policy_report");
assert.equal(policyReport.status, "passed");
const regulatedClaimsPolicy = runRegulatedClaimsPolicyV2({
  bundle: {
    businessProfile: assetBusiness,
    siteModel: { ...site, versions: [assetVersion] },
    extensionModel: { forms: [], workflows: [], customBlocks: [] },
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: assetBusiness.siteId,
      businessFactGraph: {
        id: "factgraph_regulated_policy_fixture",
        siteId: assetBusiness.siteId,
        createdAt: "2026-06-01T00:00:00.000Z",
        sources: [],
        facts: [],
        omittedFacts: [],
        sourceFactsV2: superBAutoBodyFactsV2
      },
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  },
  version: assetVersion,
  siteId: assetBusiness.siteId,
  createdAt: "2026-06-01T00:00:00.000Z"
});
assert.equal(regulatedClaimsPolicy.artifact.artifactType, "policy_report");
assert.equal(regulatedClaimsPolicy.artifact.producerId, "policy.regulated-claims");
assert.equal(regulatedClaimsPolicy.status, "passed");
const socialProofFact = {
  id: "fact_super_b_first_party_review_summary",
  kind: "review_summary" as const,
  label: "First-party review summary",
  value: "Customers mention estimate clarity and collision repair communication.",
  sourceType: "first_party" as const,
  sourceId: "fixture_review_summary",
  sourceUrl: "https://superb.example/testimonials",
  observedAt: "2026-06-01T00:00:00.000Z",
  confidence: 0.88,
  renderPolicy: "durable_render" as const,
  sourcePolicy: "durable_render" as const
};
const socialProofAudit = runSocialProofAuditV2({
  bundle: {
    businessProfile: assetBusiness,
    siteModel: { ...site, versions: [assetVersion] },
    extensionModel: { forms: [], workflows: [], customBlocks: [] },
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: assetBusiness.siteId,
      businessFactGraph: {
        id: "factgraph_social_proof_fixture",
        siteId: assetBusiness.siteId,
        createdAt: "2026-06-01T00:00:00.000Z",
        sources: [],
        facts: [],
        omittedFacts: [],
        sourceFactsV2: [...superBAutoBodyFactsV2, socialProofFact]
      },
      publicPresenceSignals: [
        {
          id: "presence_google_places_super_b",
          siteId: assetBusiness.siteId,
          provider: "google_places",
          source: "places_api",
          placeId: "places/super_b_fixture",
          confidence: 0.91,
          observedAt: "2026-06-01T00:00:00.000Z",
          fields: {
            name: assetBusiness.name
          },
          provenance: {},
          notes: ["Google profile match retained for live proof display."]
        }
      ],
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  },
  version: assetVersion,
  siteId: assetBusiness.siteId,
  createdAt: "2026-06-01T00:00:00.000Z"
});
assert.equal(socialProofAudit.artifact.artifactType, "social_proof_report");
assert.ok(socialProofAudit.scorecard.durableRenderItems >= 1);
assert.equal(socialProofAudit.scorecard.liveOnlyItems, 1);
assert.equal(socialProofAudit.scorecard.blockingIssues, 0);
assert.ok(socialProofAudit.items.some((item) => item.displayPolicy === "live_only" && item.placeId === "places/super_b_fixture"));
assert.equal(socialProofAudit.items.some((item) => /google/i.test(item.sourceUrl ?? "")), false);
const googleLeakBusiness = structuredClone(assetBusiness);
googleLeakBusiness.reviewsSummary = { rating: 4.8, count: 312, sources: ["google_places"] };
const socialProofLeakAudit = runSocialProofAuditV2({
  bundle: {
    businessProfile: googleLeakBusiness,
    siteModel: { ...site, versions: [assetVersion] },
    extensionModel: { forms: [], workflows: [], customBlocks: [] },
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: googleLeakBusiness.siteId,
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  },
  version: assetVersion,
  siteId: googleLeakBusiness.siteId,
  createdAt: "2026-06-01T00:00:00.000Z"
});
assert.ok(socialProofLeakAudit.issues.some((issue) => issue.id === "google_static_review_summary" && issue.severity === "blocking"));
const optimizationReports = runOptimizationReportsAuditV2({
  bundle: {
    businessProfile: assetBusiness,
    siteModel: { ...site, versions: [assetVersion] },
    extensionModel: { forms: [], workflows: [], customBlocks: [] },
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: assetBusiness.siteId,
      businessFactGraph: {
        id: "factgraph_optimization_reports_fixture",
        siteId: assetBusiness.siteId,
        createdAt: "2026-06-01T00:00:00.000Z",
        sources: [],
        facts: [],
        omittedFacts: [],
        sourceFactsV2: superBAutoBodyFactsV2
      },
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  },
  version: assetVersion,
  siteId: assetBusiness.siteId,
  createdAt: "2026-06-01T00:00:00.000Z"
});
assert.deepEqual(
  optimizationReports.artifacts.map((artifact) => artifact.artifactType),
  [
    "conversion_insights_report",
    "local_seo_refresh_report",
    "page_gap_analysis_report",
    "experiment_recommendation_report"
  ]
);
assert.equal(optimizationReports.reports.conversionInsights.status, "collecting");
assert.ok(optimizationReports.reports.localSeoRefresh.scorecard.actionItems >= 1);
assert.ok(optimizationReports.reports.pageGapAnalysis.scorecard.actionItems >= 1);
const designSectionAudits = runDesignSectionAuditsV2({
  bundle: {
    businessProfile: assetBusiness,
    siteModel: { ...site, versions: [assetVersion] },
    extensionModel: { forms: [], workflows: [], customBlocks: [] },
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: assetBusiness.siteId,
      businessFactGraph: {
        id: "factgraph_design_section_fixture",
        siteId: assetBusiness.siteId,
        createdAt: "2026-06-01T00:00:00.000Z",
        sources: [],
        facts: [],
        omittedFacts: [],
        sourceFactsV2: superBAutoBodyFactsV2
      },
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  },
  version: assetVersion,
  siteId: assetBusiness.siteId,
  createdAt: "2026-06-01T00:00:00.000Z"
});
assert.equal(designSectionAudits.artifacts.length, 6);
assert.ok(designSectionAudits.artifacts.every((artifact) => artifact.artifactType === "design_section_audit_report"));
assert.ok(designSectionAudits.reports.some((report) => report.skillId === "section.contact-location-hours" && report.status === "needs_review"));
assert.ok(designSectionAudits.reports.some((report) => report.skillId === "section.service-matrix" && report.scorecard.passes >= 2));
const performanceAudit = runPerformanceAuditV2({
  bundle: {
    businessProfile: assetBusiness,
    siteModel: { ...site, versions: [assetVersion] },
    extensionModel: { forms: [], workflows: [], customBlocks: [] },
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: assetBusiness.siteId,
      renderInspection: {
        target: "generated_site",
        sourceUrl: "https://generated.lodesta.local/test",
        adapter: "playwright",
        capturedAt: "2026-06-01T00:00:00.000Z",
        screenshots: [],
        findings: [],
        metrics: {
          htmlBytes: 100000,
          brokenImageCount: 0,
          horizontalOverflowPx: 0
        },
        metricsByViewport: {}
      },
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  },
  version: assetVersion,
  siteId: assetBusiness.siteId,
  createdAt: "2026-06-01T00:00:00.000Z"
});
assert.equal(performanceAudit.artifact.artifactType, "performance_audit_report");
assert.ok(performanceAudit.findings.some((finding) => finding.id === "performance_field_vitals_pending"));
const visualQualityAudit = runVisualQualityAuditV2({
  bundle: {
    businessProfile: assetBusiness,
    siteModel: { ...site, versions: [assetVersion] },
    extensionModel: { forms: [], workflows: [], customBlocks: [] },
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: assetBusiness.siteId,
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  },
  version: assetVersion,
  siteId: assetBusiness.siteId,
  createdAt: "2026-06-01T00:00:00.000Z"
});
assert.equal(visualQualityAudit.artifact.artifactType, "visual_benchmark");
assert.ok(visualQualityAudit.visualQa.findings.length >= 3);

const markdown = markdownForPage(
  fixtureBundle(),
  version.pages[0]!,
  new Headers({ host: "localhost:4330" })
);
assert.ok(markdown.includes("## Paint and body repair options"));
assert.ok(markdown.includes("Collision repair"));
assert.ok(markdown.includes("Dent repair"));
assert.equal(markdown.includes("4.8"), false);
assert.equal(markdown.includes("312"), false);

const generation = await localRepository.createSiteGeneration({
  id: "sitegen_v2_promotion_fixture",
  bundle: fixtureBundle(),
  status: "ready"
});
await localRepository.upsertGenerationArtifact({
  id: "artifact_v2_promotion_fixture",
  generationId: generation.id,
  scope: "generation_selected",
  artifactType: "copy_artifact",
  artifactVersion: copyArtifacts[0]!.artifactVersion,
  producerId: copyArtifacts[0]!.producerId,
  producerVersion: copyArtifacts[0]!.producerVersion,
  verticalPlaybookVersion: copyArtifacts[0]!.verticalPlaybookVersion,
  sectionContractVersion: copyArtifacts[0]!.sectionContractVersion,
  sourceFactIds: copyArtifacts[0]!.claimSpans.flatMap((span) => span.sourceFactIds),
  affectedSlotId: copyArtifacts[0]!.slotId,
  contentHash: version.artifactRefs[0]!.contentHash,
  payload: { text: copyArtifacts[0]!.text },
  createdAt: "2026-06-01T00:00:00.000Z"
});
const promoted = await localRepository.promoteSiteGeneration(generation.id);
assert.ok(promoted?.generation.createdSiteId);
const promotedArtifacts = await localRepository.listGenerationArtifacts({
  siteId: promoted.generation.createdSiteId,
  scope: "managed_site_selected"
});
assert.equal(promotedArtifacts.length, 1);
assert.equal(promotedArtifacts[0]?.generationId, undefined);
const promotedVersion = promoted.bundle.siteModel.versions[0];
const copyRefreshAudit = runCopyRefreshAuditV2({
  bundle: promoted.bundle,
  version: promotedVersion,
  siteId: promoted.bundle.businessProfile.siteId,
  createdAt: "2026-06-01T00:00:00.000Z"
});
assert.ok(copyRefreshAudit.diffs.some((diff) => diff.status === "proposed"));
assert.ok(copyRefreshAudit.artifacts.some((artifact) => artifact.artifactType === "copy_diff"));
for (const artifact of copyRefreshAudit.artifacts) await localRepository.upsertGenerationArtifact(artifact);
const copyRefreshDiffArtifacts = await localRepository.listGenerationArtifacts({
  siteId: promoted.bundle.businessProfile.siteId,
  scope: "managed_site_candidate",
  artifactType: "copy_diff"
});
assert.ok(copyRefreshDiffArtifacts.length >= 1, "Copy refresh skill should persist proposed managed-site copy diffs.");
assert.equal(copyRefreshDiffArtifacts[0]?.generationId, undefined);
const pageOpportunitiesAudit = runPageOpportunitiesAuditV2({
  bundle: promoted.bundle,
  version: promotedVersion,
  siteId: promoted.bundle.businessProfile.siteId,
  createdAt: "2026-06-01T00:00:00.000Z"
});
assert.ok(pageOpportunitiesAudit.opportunities.some((opportunity) => opportunity.kind === "service_page"));
assert.ok(pageOpportunitiesAudit.opportunities.some((opportunity) => opportunity.kind === "faq_page"));
await localRepository.upsertGenerationArtifact(pageOpportunitiesAudit.artifact);
const localLandingPagesAudit = runLocalLandingPagesAuditV2({
  bundle: promoted.bundle,
  version: promotedVersion,
  siteId: promoted.bundle.businessProfile.siteId,
  createdAt: "2026-06-01T00:00:00.000Z"
});
assert.equal(localLandingPagesAudit.artifact.producerId, "seo.local-landing-pages");
assert.ok(localLandingPagesAudit.opportunities.every((opportunity) => opportunity.kind === "service_page" || opportunity.kind === "location_page"));
await localRepository.upsertGenerationArtifact(localLandingPagesAudit.artifact);
const pageOpportunityArtifacts = await localRepository.listGenerationArtifacts({
  siteId: promoted.bundle.businessProfile.siteId,
  scope: "managed_site_candidate",
  artifactType: "page_opportunity_report"
});
assert.equal(pageOpportunityArtifacts.length, 2);
assert.ok(pageOpportunityArtifacts.some((artifact) => artifact.producerId === "strategy.page-opportunities"));
assert.ok(pageOpportunityArtifacts.some((artifact) => artifact.producerId === "seo.local-landing-pages"));
const contextRefreshBundle = structuredClone(promoted.bundle);
contextRefreshBundle.presenceAssessment.businessFactGraph = {
  id: "factgraph_context_refresh_fixture",
  siteId: contextRefreshBundle.businessProfile.siteId,
  createdAt: "2026-06-01T00:00:00.000Z",
  sources: [],
  facts: [],
  omittedFacts: [],
  sourceFactsV2: superBAutoBodyFactsV2
};
const contextRefreshAudit = runBusinessContextRefreshV2({
  bundle: contextRefreshBundle,
  version: promotedVersion,
  siteId: contextRefreshBundle.businessProfile.siteId,
  observedFacts: [
    ...superBAutoBodyFactsV2,
    {
      id: "fact_super_b_service_hail",
      kind: "service",
      label: "Service",
      value: "Hail damage repair",
      sourceType: "crawl",
      sourceUrl: "https://superb.example/services",
      observedAt: "2026-06-01T00:00:00.000Z",
      confidence: 0.91,
      renderPolicy: "durable_render",
      sourcePolicy: "durable_render"
    }
  ],
  createdAt: "2026-06-01T00:00:00.000Z"
});
assert.ok(contextRefreshAudit.changes.some((change) => change.factKind === "service" && change.recommendedAction === "update_site"));
assert.ok(contextRefreshAudit.impacts.some((impact) => impact.action === "update_site" && impact.affectedSectionIds.includes("services_matrix")));
for (const artifact of contextRefreshAudit.artifacts) await localRepository.upsertGenerationArtifact(artifact);
const businessContextArtifacts = await localRepository.listGenerationArtifacts({
  siteId: promoted.bundle.businessProfile.siteId,
  scope: "managed_site_candidate",
  artifactType: "business_context_report"
});
const changeImpactArtifacts = await localRepository.listGenerationArtifacts({
  siteId: promoted.bundle.businessProfile.siteId,
  scope: "managed_site_candidate",
  artifactType: "change_impact_report"
});
assert.equal(businessContextArtifacts.length, 1);
assert.equal(changeImpactArtifacts.length, 1);
assert.equal(changeImpactArtifacts[0]?.producerId, "business.change-impact");
const identityServiceAudit = runBusinessIdentityServiceAuditV2({
  bundle: contextRefreshBundle,
  version: promotedVersion,
  siteId: contextRefreshBundle.businessProfile.siteId,
  createdAt: "2026-06-01T00:00:00.000Z"
});
assert.ok(identityServiceAudit.identity.some((field) => field.field === "name" && field.status === "confirmed"));
assert.ok(identityServiceAudit.services.some((service) => service.name === "Collision repair" && service.status === "render_safe"));
for (const artifact of identityServiceAudit.artifacts) await localRepository.upsertGenerationArtifact(artifact);
const identityArtifacts = await localRepository.listGenerationArtifacts({
  siteId: promoted.bundle.businessProfile.siteId,
  scope: "managed_site_candidate",
  artifactType: "identity_reconcile_report"
});
const serviceCatalogArtifacts = await localRepository.listGenerationArtifacts({
  siteId: promoted.bundle.businessProfile.siteId,
  scope: "managed_site_candidate",
  artifactType: "service_catalog_report"
});
assert.equal(identityArtifacts.length, 1);
assert.equal(serviceCatalogArtifacts.length, 1);
assert.equal(serviceCatalogArtifacts[0]?.producerId, "business.service-catalog");
const strategyAudit = runStrategyPlanningAuditV2({
  bundle: contextRefreshBundle,
  version: promotedVersion,
  siteId: contextRefreshBundle.businessProfile.siteId,
  createdAt: "2026-06-01T00:00:00.000Z"
});
assert.equal(strategyAudit.verticalClassification.selectedVertical, "auto_body");
assert.equal(strategyAudit.conversionPath.primaryGoal, "calls");
assert.ok(strategyAudit.informationArchitecture.pages[0]?.sections.some((section) => section.family === "services.matrix"));
for (const artifact of strategyAudit.artifacts) await localRepository.upsertGenerationArtifact(artifact);
const strategyArtifacts = await localRepository.listGenerationArtifacts({
  siteId: promoted.bundle.businessProfile.siteId,
  scope: "managed_site_candidate"
});
assert.ok(strategyArtifacts.some((artifact) => artifact.artifactType === "vertical_classification_report"));
assert.ok(strategyArtifacts.some((artifact) => artifact.artifactType === "conversion_path_report"));
assert.ok(strategyArtifacts.some((artifact) => artifact.artifactType === "information_architecture_report"));
const brandDirectionAudit = runBrandDirectionV2({
  bundle: promoted.bundle,
  version: promotedVersion,
  siteId: promoted.bundle.businessProfile.siteId,
  createdAt: "2026-06-01T00:00:00.000Z"
});
assert.ok(brandDirectionAudit.cueReport.cues.includes("Super B Paint and Body"));
assert.equal(brandDirectionAudit.cueReport.rightsPolicy.generatedBrandMarkAllowed, false);
assert.ok(brandDirectionAudit.directionReport.preservationRules.some((rule) => rule.includes("brand marks require separate product/legal approval")));
for (const artifact of brandDirectionAudit.artifacts) await localRepository.upsertGenerationArtifact(artifact);
const brandCueArtifacts = await localRepository.listGenerationArtifacts({
  siteId: promoted.bundle.businessProfile.siteId,
  scope: "managed_site_candidate",
  artifactType: "brand_cue_report"
});
const brandDirectionArtifacts = await localRepository.listGenerationArtifacts({
  siteId: promoted.bundle.businessProfile.siteId,
  scope: "managed_site_candidate",
  artifactType: "brand_direction_report"
});
assert.equal(brandCueArtifacts.length, 1);
assert.equal(brandDirectionArtifacts.length, 1);
assert.equal(brandDirectionArtifacts[0]?.producerId, "brand.direction");
const brandMarkGate = runBrandMarkGenerationGateV2({
  bundle: promoted.bundle,
  version: promotedVersion,
  siteId: promoted.bundle.businessProfile.siteId,
  createdAt: "2026-06-01T00:00:00.000Z"
});
assert.equal(brandMarkGate.artifact.artifactType, "brand_mark_generation_report");
assert.equal(brandMarkGate.status, "blocked_pending_product_legal");
assert.equal(brandMarkGate.report.allowedPublicOutput, false);
await localRepository.upsertGenerationArtifact(brandMarkGate.artifact);
const brandMarkArtifacts = await localRepository.listGenerationArtifacts({
  siteId: promoted.bundle.businessProfile.siteId,
  scope: "managed_site_candidate",
  artifactType: "brand_mark_generation_report"
});
assert.equal(brandMarkArtifacts.length, 1);
assert.equal(brandMarkArtifacts[0]?.producerId, "brand.mark-generation");

const googleLeakBundle = fixtureBundle();
googleLeakBundle.presenceAssessment.publicPresenceSignals = [
  {
    id: "presence_google_places_leak",
    siteId: superBAutoBodyBusinessV2.siteId,
    provider: "google_places",
    source: "places_api",
    placeId: "places_leak",
    confidence: 0.9,
    observedAt: "2026-06-01T00:00:00.000Z",
    fields: { rating: 4.8, userRatingCount: 312, googleMapsUri: "https://maps.google.example/leak" },
    provenance: {},
    notes: []
  }
];
assert.ok(blockersFromSiteModel(googleLeakBundle, version).some((blocker) => blocker.id === "v2_google_places_static_proof_signal"));

const previousV2Mode = process.env.GENERATED_SITE_V2_MODE;
delete process.env.GENERATED_SITE_V2_MODE;
const generatedWithDefaultV2 = await generateSite({
  repository: telemetryBackedLocalRepository(),
  input: {
    prompt:
      "Create a site for a body shop called Super B Paint and Body. Services: Collision repair, Paint and body work, Dent repair, Repair estimates. Phone: (555) 123-4567. Address: 1 Main St, Dallas, TX 75201."
  },
  source: "admin_console"
});
assert.equal(
  generatedWithDefaultV2.bundle.siteModel.versions[0]?.rendererVersion,
  "layout-v2",
  "Supported vertical generations should use layout-v2 by default without an admin checkbox or env override."
);

process.env.GENERATED_SITE_V2_MODE = "operator_allowlist";
const generated = await generateSite({
  repository: telemetryBackedLocalRepository(),
  input: {
    prompt:
      "Create a site for a body shop called Super B Paint and Body. Services: Collision repair, Paint and body work, Dent repair, Repair estimates. Phone: (555) 123-4567. Address: 1 Main St, Dallas, TX 75201. Hours: Monday 8:00 AM - 5:00 PM; Tuesday 8:00 AM - 5:00 PM."
  },
  source: "admin_console",
  metadata: { generatedSiteV2: true }
});
const generatedVersion = generated.bundle.siteModel.versions[0];
assert.equal(generatedVersion?.rendererVersion, "layout-v2");
assert.equal(
  generatedVersion?.generationQa?.blockers.filter((blocker) => blocker.id !== "render_browser_unavailable").length,
  0,
  JSON.stringify(generatedVersion?.generationQa?.blockers ?? [], null, 2)
);
const generatedArtifacts = await localRepository.listGenerationArtifacts({
  generationId: generated.generationId,
  artifactType: "copy_artifact",
  scope: "generation_selected"
});
assert.ok(generatedArtifacts.length >= 4, "Generated layout-v2 path should persist selected copy artifacts.");

const generatedRestaurant = await generateSite({
  repository: telemetryBackedLocalRepository(),
  input: {
    prompt:
      "Create a site for North Loop Tacos, a restaurant. Services: Tacos, Catering, Takeout. Phone: (555) 555-0102. Address: 22 North Loop Ave, Austin, TX 78751. Hours: Monday 11:00 AM - 9:00 PM; Tuesday 11:00 AM - 9:00 PM."
  },
  source: "admin_console",
  metadata: { generatedSiteV2: true }
});
const generatedRestaurantVersion = generatedRestaurant.bundle.siteModel.versions[0];
assert.equal(generatedRestaurantVersion?.rendererVersion, "layout-v2");
assert.ok(
  generatedRestaurantVersion?.rendererVersion === "layout-v2" &&
    generatedRestaurantVersion.compiledPages[0]?.sections.some((section) => section.family === "menu.highlights"),
  "Restaurant V2 generation should compile a menu highlights section."
);

const generatedHomeServices = await generateSite({
  repository: telemetryBackedLocalRepository(),
  input: {
    prompt:
      "Create a site for Clear Flow Home Services, a home services plumbing company. Services: Plumbing repairs, Drain cleaning, Maintenance. Service areas: Charlotte, Huntersville, Matthews. Phone: (555) 555-0144."
  },
  source: "admin_console",
  metadata: { generatedSiteV2: true }
});
const generatedHomeServicesVersion = generatedHomeServices.bundle.siteModel.versions[0];
assert.equal(generatedHomeServicesVersion?.rendererVersion, "layout-v2");
assert.ok(
  generatedHomeServicesVersion?.rendererVersion === "layout-v2" &&
    generatedHomeServicesVersion.compiledPages[0]?.sections.some((section) => section.family === "coverage.service_area"),
  "Home-services V2 generation should compile a coverage section."
);

process.env.GENERATED_SITE_V2_MODE = "all_canonical";
const generatedFallbackVertical = await generateSite({
  repository: telemetryBackedLocalRepository(),
  input: {
    prompt:
      "Create a site for Cedar Park Legal, a law firm. Services: Estate planning, Business contracts, Consultations. Phone: (555) 555-0188. Address: 44 Counsel Rd, Cedar Park, TX 78613."
  },
  source: "admin_console"
});
const generatedFallbackVersion = generatedFallbackVertical.bundle.siteModel.versions[0];
assert.equal(generatedFallbackVersion?.rendererVersion, "layout-v2");
assert.equal(generatedFallbackVersion?.blueprint.vertical, "law_firm");
assert.equal(generatedFallbackVersion?.blueprint.verticalPlaybookVersion, "general-local-playbook-v1");
assert.ok(
  generatedFallbackVersion?.rendererVersion === "layout-v2" &&
    generatedFallbackVersion.compiledPages[0]?.sections.some((section) => section.family === "hero.local_action"),
  "Unsupported V2 verticals should compile through the general_local fallback playbook."
);
if (previousV2Mode === undefined) delete process.env.GENERATED_SITE_V2_MODE;
else process.env.GENERATED_SITE_V2_MODE = previousV2Mode;

console.log("Generated-site V2 contracts verified.");

function fixtureBundle(): SiteBundle {
  return {
    businessProfile: structuredClone(superBAutoBodyBusinessV2),
    siteModel: structuredClone(site),
    extensionModel: { forms: [], workflows: [], customBlocks: [] },
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: superBAutoBodyBusinessV2.siteId,
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  };
}

function telemetryBackedLocalRepository(): typeof localRepository {
  const now = () => new Date().toISOString();
  return {
    ...localRepository,
    async createAgentRun(input) {
      const timestamp = now();
      return {
        id: `run_${crypto.randomUUID().replace(/-/g, "")}`,
        runType: input.runType,
        agentType: input.agentType,
        status: input.status ?? "running",
        source: input.source,
        actorType: input.actorType,
        actorId: input.actorId,
        sourceUrl: input.sourceUrl,
        sourceHost: input.sourceHost,
        targetType: input.targetType ?? undefined,
        targetId: input.targetId ?? undefined,
        inputSummary: input.inputSummary,
        outputSummary: input.outputSummary,
        inputJson: input.inputJson,
        outputJson: input.outputJson,
        metadata: input.metadata,
        tags: input.tags ?? [],
        notes: input.notes ?? undefined,
        errorCode: input.errorCode ?? undefined,
        errorMessage: input.errorMessage ?? undefined,
        startedAt: input.startedAt ?? timestamp,
        endedAt: input.endedAt ?? undefined,
        createdAt: timestamp,
        updatedAt: timestamp
      };
    },
    async updateAgentRun(input) {
      const timestamp = now();
      return {
        id: input.runId,
        runType: "site_generation",
        agentType: "site_generator",
        status: input.status ?? "completed",
        source: "admin_console",
        targetType: input.targetType ?? undefined,
        targetId: input.targetId ?? undefined,
        outputSummary: input.outputSummary ?? undefined,
        outputJson: input.outputJson ?? undefined,
        metadata: input.metadata,
        tags: input.tags ?? [],
        notes: input.notes ?? undefined,
        errorCode: input.errorCode ?? undefined,
        errorMessage: input.errorMessage ?? undefined,
        startedAt: timestamp,
        endedAt: input.endedAt ?? timestamp,
        createdAt: timestamp,
        updatedAt: timestamp
      };
    },
    async createAgentRunSpan(input) {
      const timestamp = now();
      return {
        id: `span_${crypto.randomUUID().replace(/-/g, "")}`,
        runId: input.runId,
        parentSpanId: input.parentSpanId,
        spanType: input.spanType,
        name: input.name,
        status: input.status ?? "running",
        inputJson: input.inputJson,
        outputJson: input.outputJson,
        metadata: input.metadata,
        artifactRefs: input.artifactRefs,
        errorMessage: input.errorMessage,
        startedAt: input.startedAt ?? timestamp,
        endedAt: input.endedAt,
        durationMs: input.durationMs
      };
    },
    async updateAgentRunSpan(input) {
      return {
        id: input.spanId,
        runId: "run_generated_site_v2_contracts",
        spanType: "test",
        name: "test span",
        status: input.status ?? "completed",
        outputJson: input.outputJson ?? undefined,
        metadata: input.metadata,
        artifactRefs: input.artifactRefs,
        errorMessage: input.errorMessage ?? undefined,
        startedAt: now(),
        endedAt: input.endedAt ?? now(),
        durationMs: input.durationMs ?? undefined
      };
    },
    async recordAgentModelCall(input) {
      const timestamp = now();
      return {
        id: `model_${crypto.randomUUID().replace(/-/g, "")}`,
        runId: input.runId,
        spanId: input.spanId,
        provider: input.provider,
        model: input.model,
        endpoint: input.endpoint,
        operation: input.operation,
        status: input.status,
        requestJson: input.requestJson,
        responseJson: input.responseJson,
        usageJson: input.usageJson,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        cacheCreationTokens: input.cacheCreationTokens,
        cacheReadTokens: input.cacheReadTokens,
        errorMessage: input.errorMessage,
        startedAt: timestamp,
        endedAt: input.endedAt,
        durationMs: input.durationMs
      };
    }
  };
}
