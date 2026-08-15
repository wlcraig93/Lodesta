import assert from "node:assert/strict";
import sharp from "sharp";
import { createArtifactContactSheets } from "../packages/site-verification/contact-sheet";
import {
  assessmentCalibrationDatasetSchema,
  summarizeAssessmentCalibration
} from "../packages/website-assessment/calibration";
import {
  websiteAssessmentSchema,
  type AssessmentCriterionInput,
  type AssessmentDimension,
  type AssessmentUnknownReason,
  type WebsiteAssessment,
  type WebsiteAssessmentTargetKind
} from "../packages/website-assessment/contracts";
import {
  buildWebsiteAssessment,
  websiteAssessmentCapsFor,
  websiteAssessmentGradeBandFor
} from "../packages/website-assessment/engine";
import { publicWebsiteAssessmentProjection } from "../packages/website-assessment/public-projection";
import {
  assessmentCriteria,
  assessmentDimensions,
  websiteAssessmentRubricIdentity,
  websiteAssessmentScannerIdentity,
  websiteAssessmentScoringPolicy
} from "../packages/website-assessment/rubric";
import {
  inferWebsiteHealthPurposeTags,
  selectArtifactVisualRoutes,
  selectWebsiteHealthRoutes,
  websiteHealthRequestedRouteSlots,
  websiteHealthRouteSelectionIdentity
} from "../packages/website-assessment/route-selection";
import { inferAssessmentVertical } from "../packages/website-assessment/vertical";
import { compareRetainedSourcePreparations } from "../packages/business-data/source-preparation-diff";
import {
  businessStateSchema,
  sourceSnapshotSchema
} from "../packages/site-contracts";

const now = "2026-07-27T12:00:00.000Z";
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const routeSelection = selectWebsiteHealthRoutes([
  { route: "/", purposeTags: ["home"], priority: 100 },
  { route: "/water-heaters", purposeTags: ["service_detail"], priority: 90, contentLength: 1_200 },
  { route: "/contact", purposeTags: ["contact"], priority: 80 }
]);

const artifactVisualRoutes = selectArtifactVisualRoutes([
  { path: "/", title: "Home", description: "Home" },
  { path: "/pest-control", title: "Pest Control", description: "Primary pest-control service" },
  { path: "/contact", title: "Contact", description: "Contact the business" },
  { path: "/locations", title: "Service Areas", description: "Locations served" }
], [
  { slug: "", purpose: "home" },
  { slug: "pest-control", purpose: "service_detail" },
  { slug: "locations", purpose: "location" },
  { slug: "contact", purpose: "contact" }
]);
assert.deepEqual(
  artifactVisualRoutes.selected.map((selection) => selection.route),
  ["/", "/pest-control", "/contact"],
  "Artifact verification and evaluation must share one deterministic representative-route selection."
);
const siteInventory: WebsiteAssessment["siteInventory"] = {
  source: "complete_crawl",
  coverage: "complete",
  discoveredUrls: 3,
  eligiblePages: 3,
  assessedPages: 3,
  failedPages: 0,
  contentDepth: {
    substantivePages: 2,
    thinPages: 0,
    unclassifiedPages: 0
  },
  pageTypes: [
    { id: "home", label: "Homepage", count: 1 },
    { id: "service", label: "Service pages", count: 1 },
    { id: "location", label: "Location pages", count: 0 },
    { id: "about", label: "About pages", count: 0 },
    { id: "contact", label: "Contact pages", count: 1 },
    { id: "faq", label: "FAQ pages", count: 0 },
    { id: "proof", label: "Proof and case studies", count: 0 },
    { id: "comparison", label: "Comparison pages", count: 0 },
    { id: "editorial", label: "Articles and resources", count: 0 },
    { id: "legal", label: "Legal pages", count: 0 },
    { id: "other", label: "Other pages", count: 0 }
  ]
};

const checks: Array<{ name: string; detail: string }> = [];
function record(name: string, detail: string, assertion: () => void) {
  assertion();
  checks.push({ name, detail });
}
async function recordAsync(name: string, detail: string, assertion: () => Promise<void>) {
  await assertion();
  checks.push({ name, detail });
}

function criterionInputs(input: {
  statuses?: Record<string, AssessmentCriterionInput["status"]>;
  unknownReasons?: Record<string, AssessmentUnknownReason>;
  defaultStatus?: AssessmentCriterionInput["status"];
} = {}) {
  return assessmentCriteria
    .filter((criterion) => criterion.scoreEligible)
    .map((criterion): AssessmentCriterionInput => {
      const status = input.statuses?.[criterion.id] ?? input.defaultStatus ?? "pass";
      return {
        id: criterion.id,
        status,
        certainty: criterion.evaluatorType === "model" ? "inferred" : "deterministic",
        ...(status === "unknown"
          ? { unknownReason: input.unknownReasons?.[criterion.id] ?? "site_evidence_missing" }
          : {}),
        explanation: `${criterion.title}: ${status} fixture evidence.`,
        evidence: [{
          id: `${criterion.id}.fixture`,
          kind: "system",
          summary: `${criterion.id} ${status} fixture evidence.`,
          observedAt: now
        }]
      };
    });
}

function report(input: {
  kind?: WebsiteAssessmentTargetKind;
  criteria?: AssessmentCriterionInput[];
  canonicalFacts?: Partial<WebsiteAssessment["canonicalFactAvailability"]>;
  deterministicReleaseBlockers?: string[];
} = {}) {
  const kind = input.kind ?? "public_url";
  return buildWebsiteAssessment({
    id: `health_${kind}_${Math.random().toString(16).slice(2)}`,
    target: {
      kind,
      sourceKey: `${kind}:fixture`,
      sourceUrl: kind === "site_artifact" ? undefined : "https://example.com/",
      siteId: kind === "public_url" ? undefined : "site_fixture",
      artifactId: kind === "site_artifact" ? "artifact_fixture" : undefined,
      versionId: kind === "published_site" ? "version_fixture" : undefined
    },
    siteUnderstanding: {
      businessName: "Example Plumbing",
      primaryLocation: "Denver, CO",
      services: ["Water heater repair", "Drain cleaning"],
      vertical: "plumber",
      verticalConfidence: 1,
      verticalEvidence: ["Fixture vertical."],
      customerJourneys: ["Call for service", "Evaluate water heater repair"]
    },
    canonicalFactAvailability: {
      businessName: true,
      phone: true,
      email: true,
      address: true,
      hours: true,
      coordinates: true,
      serviceAreas: true,
      proof: true,
      ...input.canonicalFacts
    },
    routeSelection,
    siteInventory,
    criteria: input.criteria ?? criterionInputs(),
    agentReadinessChecks: [],
    deterministicReleaseBlockers: input.deterministicReleaseBlockers,
    generatedAt: now,
    inputHashSource: { fixture: kind, criteria: input.criteria ?? "all-pass" }
  });
}

record("registry_contract", "The unified registry has stable unique definitions, all required gaps, and ten weights totaling 100.", () => {
  assert(assessmentCriteria.length >= 76);
  assert.equal(new Set(assessmentCriteria.map((criterion) => criterion.id)).size, assessmentCriteria.length);
  assert.equal(new Set(assessmentCriteria.map((criterion) => criterion.definitionIdentity)).size, assessmentCriteria.length);
  assert.equal(assessmentDimensions.length, 10);
  assert.equal(assessmentDimensions.reduce((sum, dimension) => sum + dimension.weight, 0), 100);
  for (const id of [
    "functional.navigation_reachability",
    "conversion.click_to_call",
    "content.five_second_clarity",
    "content.priority_intent_coverage",
    "content.decision_support",
    "content.hours_presence",
    "trust.proof_specificity",
    "visual.brand.distinctiveness",
    "visual.composition.density_pacing",
    "visual.navigation.presentation"
  ]) {
    assert(assessmentCriteria.some((criterion) => criterion.id === id), `Missing ${id}.`);
  }
  const navigation = assessmentCriteria.find((criterion) => criterion.id === "functional.navigation_reachability");
  assert.equal(navigation?.releaseDisposition, "advisory");
  assert.equal(navigation?.evaluatorType, "deterministic");
  assert(websiteAssessmentRubricIdentity.startsWith("website-health-rubric@sha256:"));
  assert(websiteAssessmentScannerIdentity.startsWith("website-health-scanner@sha256:"));
});

const perfect = report();
record("v2_scoring", "A complete report uses v2, renormalizes inactive uncalibrated craft weight, and preserves a separate author score.", () => {
  assert.equal(websiteAssessmentSchema.safeParse(perfect).success, true);
  assert.equal(perfect.schemaVersion, 2);
  assert.equal(perfect.kind, "website-health-report");
  assert.equal(perfect.score.rawValue, 100);
  assert.equal(perfect.score.activeWeight, 92);
  assert.equal(perfect.score.renormalized, true);
  assert.equal(perfect.score.scopes.siteAuthor.value, 100);
  assert.equal(perfect.dimensions.find((dimension) => dimension.id === "visual_editorial_craft")?.state, "not_yet_scored");
  assert.equal(perfect.dimensions.find((dimension) => dimension.id === "visual_editorial_craft")?.capEligible, false);
});

record("owner_scopes", "Canonical raw score includes every owner while the bake-off score excludes platform, research, and shared criteria.", () => {
  const platformFailures = Object.fromEntries(
    assessmentCriteria
      .filter((criterion) => criterion.scoreEligible && criterion.controlOwner !== "site_author")
      .map((criterion) => [criterion.id, "fail" as const])
  );
  const owned = report({ criteria: criterionInputs({ statuses: platformFailures }) });
  assert((owned.score.rawValue ?? 100) < 100);
  assert.equal(owned.score.scopes.siteAuthor.value, 100);
  assert(owned.dimensions.flatMap((dimension) => dimension.criteria)
    .some((criterion) => criterion.controlOwner === "source_research"));
});

record("dimension_states", "Uncalibrated dimensions do not score zero, and collector failures make an expected dimension insufficient without a cap.", () => {
  const performanceIds = assessmentCriteria
    .filter((criterion) => criterion.dimensionId === "performance" && criterion.scoreEligible)
    .map((criterion) => criterion.id);
  const statuses = Object.fromEntries(performanceIds.map((id) => [id, "unknown" as const]));
  const unknownReasons = Object.fromEntries(performanceIds.map((id) => [id, "collector_unavailable" as const]));
  const incomplete = report({ criteria: criterionInputs({ statuses, unknownReasons }) });
  const performance = incomplete.dimensions.find((dimension) => dimension.id === "performance");
  assert.equal(performance?.state, "insufficient_evidence");
  assert.equal(performance?.score, undefined);
  assert.equal(performance?.capEligible, false);
  assert.equal(incomplete.score.activeWeight, 85);
  assert.equal(incomplete.grade?.provisional, true);
  assert(incomplete.coverage.pipelineCompleteness < 1);
  assert.equal(incomplete.coverage.siteEvidence, 1);
  assert.equal(incomplete.coverage.comparisonEligible, false);
});

record("dimension_cap_threshold", "A dimension needs three assessed criteria, six points, and 70% site evidence before it can cap.", () => {
  const functionalIds = assessmentCriteria
    .filter((criterion) => criterion.dimensionId === "functional_integrity" && criterion.scoreEligible)
    .map((criterion) => criterion.id);
  const build = (assessedCount: number) => {
    const statuses = Object.fromEntries(functionalIds.map((id, index) =>
      [id, index < assessedCount ? "fail" as const : "unknown" as const]));
    const unknownReasons = Object.fromEntries(functionalIds.slice(assessedCount)
      .map((id) => [id, "collector_unavailable" as const]));
    return report({ criteria: criterionInputs({ statuses, unknownReasons }) });
  };
  const thin = build(2).dimensions.find((dimension) => dimension.id === "functional_integrity");
  const sufficient = build(3).dimensions.find((dimension) => dimension.id === "functional_integrity");
  assert.equal(thin?.capEligible, false);
  assert.equal(sufficient?.assessedCriteria, 3);
  assert((sufficient?.possiblePoints ?? 0) >= 6);
  assert.equal(sufficient?.coverage.siteEvidence, 1);
  assert.equal(sufficient?.capEligible, true);
});

record("exact_caps", "Coverage, dimension, and release caps use exact inclusive and exclusive interval boundaries.", () => {
  const noDimensions: AssessmentDimension[] = perfect.dimensions.map((dimension) => ({
    ...dimension,
    capEligible: false
  }));
  const cap = (siteCoverage: number) =>
    websiteAssessmentCapsFor({ dimensions: noDimensions, siteCoverage, releaseBlockers: [] })
      .map((item) => item.maximum);
  assert.deepEqual(cap(0), [49]);
  assert.deepEqual(cap(0.4999), [49]);
  assert.deepEqual(cap(0.5), [69]);
  assert.deepEqual(cap(0.6999), [69]);
  assert.deepEqual(cap(0.7), [79]);
  assert.deepEqual(cap(0.8499), [79]);
  assert.deepEqual(cap(0.85), []);
  assert.deepEqual(cap(1), []);
  assert.equal(websiteAssessmentCapsFor({
    dimensions: noDimensions,
    siteCoverage: 1,
    releaseBlockers: ["functional.home_reachable"]
  })[0]?.maximum, 49);
  const capDimension = {
    ...perfect.dimensions.find((dimension) => dimension.id === "business_truth")!,
    capEligible: true,
    score: 49.999
  };
  assert(websiteAssessmentCapsFor({
    dimensions: [capDimension],
    siteCoverage: 1,
    releaseBlockers: []
  }).some((item) => item.maximum === 69));
  assert(websiteAssessmentCapsFor({
    dimensions: [{ ...capDimension, score: 50 }],
    siteCoverage: 1,
    releaseBlockers: []
  }).some((item) => item.maximum === 79));
  assert.equal(websiteAssessmentCapsFor({
    dimensions: [{ ...capDimension, score: 70 }],
    siteCoverage: 1,
    releaseBlockers: []
  }).length, 0);
});

record("grade_bands", "Grade bands preserve exact 90, 80, 70, and 50 boundaries.", () => {
  assert.equal(websiteAssessmentGradeBandFor(90), "excellent");
  assert.equal(websiteAssessmentGradeBandFor(89.9), "strong");
  assert.equal(websiteAssessmentGradeBandFor(80), "strong");
  assert.equal(websiteAssessmentGradeBandFor(70), "serviceable");
  assert.equal(websiteAssessmentGradeBandFor(50), "weak");
  assert.equal(websiteAssessmentGradeBandFor(49.9), "poor");
});

record("typed_unknowns", "Pipeline outages do not lower site coverage, while missing site evidence does.", () => {
  const id = assessmentCriteria.find((criterion) => criterion.scoreEligible)?.id;
  assert(id);
  const outage = report({
    criteria: criterionInputs({
      statuses: { [id]: "unknown" },
      unknownReasons: { [id]: "collector_unavailable" }
    })
  });
  const missing = report({
    criteria: criterionInputs({
      statuses: { [id]: "unknown" },
      unknownReasons: { [id]: "site_evidence_missing" }
    })
  });
  assert.equal(outage.coverage.siteEvidence, 1);
  assert(outage.coverage.pipelineCompleteness < 1);
  assert(missing.coverage.siteEvidence < 1);
  assert.equal(missing.coverage.pipelineCompleteness, 1);
});

record("release_authority", "Artifact hard-gate blockers cap the grade and remain separate from advisory navigation evidence.", () => {
  const blocked = report({
    kind: "site_artifact",
    deterministicReleaseBlockers: ["render.page_error"]
  });
  assert.equal(blocked.release.status, "failed");
  assert.deepEqual(blocked.release.blockers, ["render.page_error"]);
  assert.equal(blocked.grade?.value, 49);
  assert(blocked.grade?.appliedCaps.some((cap) => cap.id === "deterministic_release_blocker"));
  const navigation = blocked.dimensions.flatMap((dimension) => dimension.criteria)
    .find((criterion) => criterion.id === "functional.navigation_reachability");
  assert.equal(navigation?.releaseDisposition, "advisory");
});

record("canonical_hours", "Hours are applicable only with a publish-eligible fact; contradictions block while omission remains advisory.", () => {
  const unresolved = report({ canonicalFacts: { hours: false } });
  const unresolvedHours = unresolved.dimensions.flatMap((dimension) => dimension.criteria)
    .filter((criterion) => criterion.topics.includes("hours"));
  assert(unresolvedHours.every((criterion) => criterion.status === "not_applicable"));
  const contradictory = report({
    kind: "site_artifact",
    criteria: criterionInputs({ statuses: { "truth.hours_consistency": "fail" } })
  });
  assert(contradictory.release.blockers.includes("truth.hours_consistency"));
  const omitted = report({
    kind: "site_artifact",
    criteria: criterionInputs({ statuses: { "content.hours_presence": "warning" } })
  });
  assert.equal(omitted.release.status, "passed");
});

record("target_equivalence", "External, artifact, and published adapters share common criterion outcomes.", () => {
  const targetKinds = ["public_url", "site_artifact", "published_site"] as const;
  const commonIds = new Set(assessmentCriteria
    .filter((criterion) => targetKinds.every((kind) => criterion.applicabilityRules.targets.includes(kind)))
    .map((criterion) => criterion.id));
  const reports = targetKinds
    .map((kind) => report({ kind }));
  const common = reports.map((item) => item.dimensions.flatMap((dimension) => dimension.criteria)
    .filter((criterion) => commonIds.has(criterion.id))
    .map((criterion) => [criterion.id, criterion.status, criterion.pointsEarned]));
  assert.deepEqual(common[0], common[1]);
  assert.deepEqual(common[1], common[2]);
});

record("semantic_route_selection", "Different route counts resolve through the same three semantic slots and methodology identity.", () => {
  const short = selectWebsiteHealthRoutes([
    { route: "/", purposeTags: ["home"] },
    { route: "/repair", purposeTags: ["service_detail"], priority: 10 },
    { route: "/about", purposeTags: ["about"] }
  ]);
  const long = selectWebsiteHealthRoutes([
    { route: "/", purposeTags: ["home"] },
    ...Array.from({ length: 8 }, (_, index) => ({
      route: `/service-${index}`,
      purposeTags: ["service_detail"],
      priority: 20 - index,
      contentLength: 1_000 - index
    })),
    { route: "/contact-us", purposeTags: ["contact"] },
    { route: "/about-us", purposeTags: ["about"] }
  ]);
  assert.deepEqual(short.requestedSlots, [...websiteHealthRequestedRouteSlots]);
  assert.deepEqual(long.requestedSlots, [...websiteHealthRequestedRouteSlots]);
  assert.equal(short.identity, websiteHealthRouteSelectionIdentity);
  assert.equal(long.identity, websiteHealthRouteSelectionIdentity);
  assert.equal(long.selected[1]?.route, "/service-0");
  assert.equal(long.selected[2]?.route, "/contact-us");
  assert.equal(perfect.producer.routeSelectionIdentity, websiteHealthRouteSelectionIdentity);
});

record("semantic_route_selection_fallback", "Finalized route semantics select representative evidence when intent page requirements are absent.", () => {
  const inferred = [
    { route: "/", title: "Kind Pest Control", description: "Local pest control." },
    { route: "/ant-control", title: "Ant Control | Kind Pest Control", description: "Ant treatment services." },
    { route: "/about", title: "About | Kind Pest Control", description: "Meet the local team." },
    { route: "/contact", title: "Contact | Kind Pest Control", description: "Request help from the team." },
    { route: "/privacy", title: "Privacy | Kind Pest Control", description: "Privacy policy." }
  ].map((route) => ({
    route: route.route,
    purposeTags: inferWebsiteHealthPurposeTags(route)
  }));
  const selection = selectWebsiteHealthRoutes(inferred);
  assert.deepEqual(inferred.map((candidate) => candidate.purposeTags), [
    ["home"],
    ["service_detail"],
    ["about"],
    ["contact"],
    []
  ]);
  assert.deepEqual(selection.selected.map((item) => item.route), ["/", "/ant-control", "/contact"]);
});

record("artifact_vertical_evidence", "Retained business and route text classify category fit without a separate vertical catalog.", () => {
  const inferred = inferAssessmentVertical({
    textEvidence: [
      "Surge Pest Control",
      "Ant Control",
      "Termite Control",
      "Residential pest control services"
    ]
  });
  assert.equal(inferred.vertical, "home_services");
  assert(inferred.confidence >= 0.8);
});

record("source_preparation_diff", "Retained exclusion provenance distinguishes invalid and conflicting facts from unexplained source loss.", () => {
  const beforeSnapshot = sourceSnapshotSchema.parse({
    schemaVersion: 1,
    id: "snapshot_before",
    businessId: "business_fixture",
    sourceType: "website",
    sourceUrl: "https://example.com/",
    contentHash: digest("2"),
    capturedAt: now,
    payload: {}
  });
  const afterSnapshot = sourceSnapshotSchema.parse({
    schemaVersion: 1,
    id: "snapshot_after",
    businessId: "business_fixture",
    sourceType: "website",
    sourceUrl: "https://example.com/",
    contentHash: digest("3"),
    capturedAt: now,
    payload: {
      factPreparation: {
        schemaVersion: 1,
        facts: [
          {
            kind: "service_area",
            value: "homeowners",
            disposition: "invalid_value_filtering",
            reason: "The value names an audience, not a market.",
            sourceUrls: ["https://example.com/"],
            evidenceClasses: ["first_party"]
          },
          {
            kind: "hours",
            value: { Monday: "08:00-17:00" },
            disposition: "conflict_suppression",
            reason: "Two retained first-party pages supplied conflicting hours.",
            sourceUrls: ["https://example.com/", "https://example.com/contact"],
            evidenceClasses: ["first_party"]
          }
        ]
      }
    }
  });
  const stateBase = {
    schemaVersion: 1 as const,
    businessId: "business_fixture",
    siteId: "site_fixture",
    ownerOperationalRevision: 1,
    updatedAt: now,
    identity: {
      name: "Example Plumbing",
      status: "verified" as const,
      categories: ["plumber"]
    },
    contacts: {},
    locations: [],
    serviceAreas: [],
    offerings: [],
    proof: [],
    assets: [],
    links: []
  };
  const source = (factId: string) => ({
    factId,
    sourceSnapshotId: beforeSnapshot.id,
    sourceUrl: "https://example.com/",
    evidenceClass: "first_party" as const,
    observedAt: now,
    confidence: 0.75,
    ownerConfirmed: false
  });
  const beforeState = businessStateSchema.parse({
    ...stateBase,
    revision: 1,
    stateHash: digest("4"),
    facts: [
      {
        id: "fact_area",
        kind: "service_area",
        label: "Service area",
        value: "homeowners",
        source: source("fact_area"),
        publicEligible: true
      },
      {
        id: "fact_hours",
        kind: "hours",
        label: "Hours",
        value: { Monday: "08:00-17:00" },
        source: source("fact_hours"),
        publicEligible: true
      }
    ]
  });
  const afterState = businessStateSchema.parse({
    ...stateBase,
    revision: 2,
    stateHash: digest("5"),
    facts: []
  });
  const explained = compareRetainedSourcePreparations({
    beforeSnapshot,
    beforeState,
    afterSnapshot,
    afterState
  });
  assert.equal(explained.counts.removed, 2);
  assert.equal(explained.counts.unexplained, 0);
  assert.equal(explained.comparisonEligible, true);
  assert.deepEqual(
    explained.changes.map((change) => change.classification).sort(),
    ["conflict_suppression", "invalid_value_filtering"]
  );
  const unexplained = compareRetainedSourcePreparations({
    beforeSnapshot,
    beforeState,
    afterSnapshot: sourceSnapshotSchema.parse({
      ...afterSnapshot,
      id: "snapshot_without_provenance",
      contentHash: digest("6"),
      payload: {}
    }),
    afterState
  });
  assert.equal(unexplained.counts.unexplained, 2);
  assert.equal(unexplained.comparisonEligible, false);
});

await recordAsync("malformed_visual_strip", "A 390×4482 full-page strip cannot masquerade as a mobile viewport frame.", async () => {
  const strip = await sharp({
    create: { width: 390, height: 4482, channels: 3, background: "#ffffff" }
  }).png().toBuffer();
  await assert.rejects(() => createArtifactContactSheets([{
    key: "strip",
    route: "/",
    viewport: "mobile",
    stage: "settled",
    frame: "top",
    bytes: strip
  }]), /expected a labeled 390×844 native viewport frame/);
});

record("public_projection", "The public report is a projection of v2 and withholds its grade pending calibration approval.", () => {
  const projection = publicWebsiteAssessmentProjection(perfect);
  assert.equal(projection.schemaVersion, 2);
  assert.equal(projection.kind, "public-website-health-report");
  assert.equal(projection.grade.withheld, true);
  assert.equal(projection.methodology.registryIdentity, perfect.producer.rubricIdentity);
  assert.equal(projection.methodology.routeSelectionIdentity, websiteHealthRouteSelectionIdentity);
  assert.equal(projection.siteInventory.assessedPages, 3);
  assert.equal(projection.siteInventory.pageTypes.find((pageType) => pageType.id === "service")?.count, 1);
  assert.equal(projection.snapshot.verifiedChecks > 0, true);
  assert.equal(projection.agentReadiness.note.includes("advisory"), true);
  assert.equal(projection.visualQuality.note.includes("not a grade"), true);
  assert.equal(projection.dimensions.find((dimension) => dimension.id === "visual_editorial_craft")?.reviewMode, "advisory");
  assert.equal("rawValue" in projection, false);
});

record("stale_v1", "Schema-v1 assessments remain inspectable storage records but are not accepted by the v2 application contract.", () => {
  assert.equal(websiteAssessmentSchema.safeParse({
    schemaVersion: 1,
    id: "legacy",
    target: { kind: "public_url", sourceKey: "legacy" }
  }).success, false);
});

record("calibration_pins", "Calibration binds retained inputs, semantic slots, and screenshot hashes and rejects reviewer drift.", () => {
  const pins = {
    sourceSnapshots: [{ id: "snapshot_1", hash: digest("a") }],
    businessState: { revision: 1, hash: digest("b") },
    siteIntent: { revision: 1, hash: digest("c") },
    publicBuildInput: { id: "input_1", hash: digest("d") },
    artifact: { id: "artifact_1", versionId: "version_1" },
    report: { id: "report_1", hash: digest("e"), inputHash: digest("f") },
    screenshotSetHash: digest("1"),
    routeSelectionIdentity: websiteHealthRouteSelectionIdentity,
    selectedSlots: [
      { slot: "home" as const, resolvedPath: "/" },
      { slot: "primary_service" as const, resolvedPath: "/water-heaters" },
      { slot: "contact_or_about" as const, resolvedPath: "/contact" }
    ] as const
  };
  const base = {
    schemaVersion: 2 as const,
    kind: "website-health-calibration" as const,
    registryIdentity: websiteAssessmentRubricIdentity,
    scannerIdentity: websiteAssessmentScannerIdentity,
    routeSelectionIdentity: websiteHealthRouteSelectionIdentity,
    evaluatorIdentities: ["fixture-evaluator"],
    reviews: [0, 1, 2].map((index) => ({
      vertical: index ? "electrician" : "plumber",
      reviewer: `reviewer_${index}`,
      reviewedAt: now,
      pins: {
        ...pins,
        report: { ...pins.report, id: `report_${index + 1}` },
        artifact: { ...pins.artifact, id: `artifact_${index + 1}` }
      },
      automatedRankScore: 90 - index * 10,
      humanRankScore: 92 - index * 11,
      criteria: [{
        criterionId: "visual.brand.distinctiveness",
        certainty: "inferred" as const,
        scoreEligible: true,
        automatedStatus: "warning" as const,
        expectedStatus: "warning" as const
      }]
    }))
  };
  const summary = summarizeAssessmentCalibration(base);
  assert.equal(summary.reviewedSites, 3);
  assert.equal(summary.rankingAgreement, 1);
  assert.equal(summary.readiness.minimumReviewedSitesMet, false);
  assert.equal(summary.readiness.publicScoreApproved, false);
  const duplicateWithDrift = {
    ...base,
    reviews: [
      base.reviews[0],
      {
        ...base.reviews[0],
        reviewer: "reviewer_other",
        pins: { ...base.reviews[0].pins, screenshotSetHash: digest("9") }
      }
    ]
  };
  assert.equal(assessmentCalibrationDatasetSchema.safeParse(duplicateWithDrift).success, false);
});

record("scoring_policy", "Confidence is telemetry only and subjective findings are unscored until a criterion calibration identity is encoded.", () => {
  assert.equal(websiteAssessmentScoringPolicy.confidence, "telemetry_only");
  assert(assessmentCriteria
    .filter((criterion) => criterion.evaluatorType === "model")
    .every((criterion) => !criterion.scoreEligible || Boolean(criterion.calibrationIdentity)));
  assert(assessmentCriteria
    .filter((criterion) => criterion.evaluatorType === "model")
    .every((criterion) => criterion.releaseDisposition === "advisory"));
});

console.log(JSON.stringify({
  ok: true,
  checks,
  registryIdentity: websiteAssessmentRubricIdentity,
  scannerIdentity: websiteAssessmentScannerIdentity,
  routeSelectionIdentity: websiteHealthRouteSelectionIdentity,
  criterionCount: assessmentCriteria.length,
  activeWeight: perfect.score.activeWeight,
  scoringPolicy: websiteAssessmentScoringPolicy
}, null, 2));
