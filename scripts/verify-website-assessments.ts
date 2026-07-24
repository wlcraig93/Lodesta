import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";
import { sha256 } from "../packages/business-data";
import { siteBuildArtifactSchema } from "../packages/site-contracts";
import { assessSiteArtifact } from "../packages/website-assessment/site-artifact-adapter";
import { buildWebsiteAssessment } from "../packages/website-assessment/engine";
import { publicWebsiteAssessmentProjection } from "../packages/website-assessment/public-projection";
import { assessmentCriteria, assessmentDimensions } from "../packages/website-assessment/rubric";
import { summarizeAssessmentCalibration } from "../packages/website-assessment/calibration";
import type { AssessmentCriterionInput } from "../packages/website-assessment/contracts";
import { processNextWebsiteAssessmentJob } from "../packages/website-assessment/jobs";
import { inspectUrlRender } from "../lib/render-inspection";
import type {
  PlatformOperationsRepository,
  ProspectReportRecord,
  WebsiteAssessmentJob,
  WebsiteAssessmentRecord
} from "../packages/platform-operations";

const observedAt = "2026-07-23T12:00:00.000Z";

function criterionInput(statusFor: (id: string) => AssessmentCriterionInput["status"]) {
  return assessmentCriteria.map((criterion): AssessmentCriterionInput => {
    const { points, ...definition } = criterion;
    return {
      ...definition,
      status: statusFor(criterion.id),
      certainty: criterion.id === "trust.proof" ? "inferred" : "deterministic",
      confidence: criterion.id === "trust.proof" ? 0.9 : undefined,
      explanation: `${criterion.title} fixture evidence.`,
      evidence: [{ id: `${criterion.id}.fixture`, kind: "system", summary: "Fixture evidence.", observedAt }],
      pointsPossible: points
    };
  });
}

const understanding = {
  businessName: "Northstar Collision Repair",
  primaryLocation: "Austin, TX",
  services: ["Collision Repair"],
  vertical: "auto_body",
  verticalConfidence: 0.95,
  verticalEvidence: ["Collision repair language."],
  customerJourneys: ["Request an estimate"]
};

async function main() {
  assert.equal(assessmentDimensions.reduce((total, dimension) => total + dimension.weight, 0), 100);
  assert.equal(new Set(assessmentCriteria.map((criterion) => criterion.id)).size, assessmentCriteria.length);

  const strong = buildWebsiteAssessment({
    id: "website_assessment_strong",
    target: { kind: "public_url", sourceKey: "url:strong", sourceUrl: "https://strong.example/" },
    siteUnderstanding: understanding,
    criteria: criterionInput(() => "pass"),
    inputHashSource: { fixture: "strong" },
    generatedAt: observedAt
  });
  assert.equal(strong.coverage.value, 1);
  assert.equal(strong.score?.verdict, "strong");

  const criticalFailure = buildWebsiteAssessment({
    id: "website_assessment_critical",
    target: { kind: "public_url", sourceKey: "url:critical", sourceUrl: "https://critical.example/" },
    siteUnderstanding: understanding,
    criteria: criterionInput((id) => id === "functional.home_reachable" ? "fail" : "pass"),
    inputHashSource: { fixture: "critical" },
    generatedAt: observedAt
  });
  assert.equal(criticalFailure.score?.verdict, "poor", "critical failures must override the numeric score band");

  const lowCoverage = buildWebsiteAssessment({
    id: "website_assessment_low_coverage",
    target: { kind: "public_url", sourceKey: "url:unknown", sourceUrl: "https://unknown.example/" },
    siteUnderstanding: { ...understanding, vertical: "general_local", verticalConfidence: 0.35 },
    criteria: [],
    inputHashSource: { fixture: "unknown" },
    generatedAt: observedAt
  });
  assert.equal(lowCoverage.coverage.scoreEligible, false);
  assert.equal(lowCoverage.score, undefined);
  assert.equal(lowCoverage.dimensions.flatMap((dimension) => dimension.criteria).find((criterion) => criterion.id === "local_content.vertical_requirements")?.status, "not_applicable");

  const projection = publicWebsiteAssessmentProjection(criticalFailure);
  const serializedProjection = JSON.stringify(projection);
  assert.match(serializedProjection, /functional\.home_reachable/);
  assert.doesNotMatch(serializedProjection, /"score"|"verdict"|"pointsEarned"|"pointsPossible"/);

  const lowConfidenceInference = buildWebsiteAssessment({
    id: "website_assessment_low_confidence_inference",
    target: { kind: "public_url", sourceKey: "url:inference", sourceUrl: "https://inference.example/" },
    siteUnderstanding: understanding,
    criteria: criterionInput((id) => id === "trust.proof" ? "warning" : "pass").map((criterion) => (
      criterion.id === "trust.proof" ? { ...criterion, confidence: 0.7 } : criterion
    )),
    inputHashSource: { fixture: "low-confidence-inference" },
    generatedAt: observedAt
  });
  assert.equal(
    publicWebsiteAssessmentProjection(lowConfidenceInference).findings.some((finding) => finding.id === "trust.proof"),
    false,
    "inferred findings below the public confidence threshold must remain internal"
  );

  const buildInput = buildSyntheticSiteInput();
  const artifact = siteBuildArtifactSchema.parse({
    schemaVersion: 1,
    id: "artifact_assessment_fixture",
    siteId: buildInput.siteId,
    workspaceRevisionId: "workspace_revision_fixture",
    publicBuildInputId: buildInput.id,
    createdAt: observedAt,
    artifactHash: sha256("artifact"),
    storagePrefix: "site-artifacts/site_synthetic_verification/artifact_assessment_fixture",
    files: [{ path: "index.html", contentType: "text/html; charset=utf-8", contentHash: sha256("html"), bytes: 4, storageKey: "site-artifacts/site_synthetic_verification/artifact_assessment_fixture/index.html" }],
    routes: [{ path: "/", htmlFile: "index.html", title: "Northstar Collision Repair in Austin", description: "Austin collision repair estimates, verified service details, contact information, and shop location." }],
    factBindings: [{ id: "binding_schema", route: "/", text: "Northstar Collision Repair", origin: "structured_data", sourceFactIds: ["business:name"] }],
    capabilityBindings: [{ id: "capability_form_home", kind: "form", route: "/", config: { formId: "form_estimate" } }],
    runtimeSeriesId: "site-runtime-v1",
    runtimePatchAtFinalization: "runtime_patch_fixture",
    toolchainVersion: "fixture",
    sandboxImageDigest: sha256("sandbox"),
    qa: {
      hardGate: "passed",
      checkedAt: observedAt,
      routesChecked: 1,
      linksChecked: 1,
      findings: [{ id: "accessibility.axe.complete", severity: "info", area: "accessibility", message: "axe-core completed.", route: "/" }],
      screenshotKeys: ["site-captures/site_synthetic_verification/artifact_assessment_fixture/home-mobile.png"]
    }
  });
  const artifactAssessment = assessSiteArtifact({ artifact, buildInput, assessmentId: "website_assessment_artifact" });
  assert.equal(artifactAssessment.target.artifactId, artifact.id);
  assert.match(artifactAssessment.coverage.limitations.join(" "), /ingestion and verification evidence/);
  assert.equal(artifactAssessment.dimensions.flatMap((dimension) => dimension.criteria).find((criterion) => criterion.id === "functional.form_path")?.status, "pass");

  const calibration = summarizeAssessmentCalibration({
    schemaVersion: 1,
    kind: "website-assessment-calibration",
    rubricIdentity: strong.producer.rubricIdentity,
    reviews: [{
      assessmentId: strong.id,
      vertical: "auto_body",
      reviewer: "reviewer_fixture",
      reviewedAt: observedAt,
      criteria: [{ criterionId: "trust.proof", certainty: "inferred", automatedStatus: "warning", expectedStatus: "warning" }]
    }]
  });
  assert.equal(calibration.inferredPrecision, 1);
  assert.equal(calibration.readiness.minimumReviewedSitesMet, false);
  assert.equal(calibration.readiness.launchVerticalCoverageMet, false);
  assert.equal(calibration.readiness.everyDisagreementDocumented, true);
  assert.equal(calibration.readiness.publicScoreApproved, false);

  const retryRecord: WebsiteAssessmentRecord = {
    id: strong.id,
    status: "completed",
    targetKind: "public_url",
    sourceKey: strong.target.sourceKey,
    sourceUrl: strong.target.sourceUrl,
    rubricIdentity: strong.producer.rubricIdentity,
    scannerIdentity: strong.producer.scannerIdentity,
    assessment: strong,
    createdAt: observedAt,
    updatedAt: observedAt,
    completedAt: observedAt
  };
  let retryReport: ProspectReportRecord = {
    id: "prospect_report_retry_fixture",
    sourceKey: strong.target.sourceKey,
    status: "running",
    assessmentId: strong.id,
    sourceUrl: strong.target.sourceUrl,
    sourceHost: "strong.example",
    websiteKind: "owned_website",
    createdAt: observedAt,
    updatedAt: observedAt
  };
  const retryJob: WebsiteAssessmentJob = {
    id: "website_assessment_job_retry_fixture",
    assessmentId: strong.id,
    prospectReportId: retryReport.id,
    status: "running",
    attempts: 2,
    maxAttempts: 2,
    runAfter: observedAt,
    createdAt: observedAt,
    updatedAt: observedAt
  };
  let assessmentUpdates = 0;
  let completedJobs = 0;
  let claimed = false;
  const retryRepository = {
    async claimNextWebsiteAssessmentJob() {
      if (claimed) return null;
      claimed = true;
      return retryJob;
    },
    async getWebsiteAssessment() {
      return retryRecord;
    },
    async updateWebsiteAssessment() {
      assessmentUpdates += 1;
      throw new Error("A completed assessment must not be rewritten.");
    },
    async getProspectReport() {
      return retryReport;
    },
    async updateProspectReport(input: Parameters<PlatformOperationsRepository["updateProspectReport"]>[0]) {
      retryReport = {
        ...retryReport,
        ...Object.fromEntries(Object.entries(input).filter(([key]) => !["reportId", "clearError"].includes(key))),
        updatedAt: observedAt
      } as ProspectReportRecord;
      return retryReport;
    },
    async completeWebsiteAssessmentJob() {
      completedJobs += 1;
    },
    async failWebsiteAssessmentJob() {
      throw new Error("The recovery fixture must not fail the job.");
    }
  };
  const retried = await processNextWebsiteAssessmentJob({
    repository: retryRepository,
    runAssessment: async () => {
      throw new Error("A completed assessment must be reused.");
    }
  });
  assert.equal(retried?.status, "completed");
  assert.equal(assessmentUpdates, 0);
  assert.equal(retryReport.status, "completed");
  assert.equal(completedJobs, 1);

  const blockedRender = await inspectUrlRender({
    url: "http://127.0.0.1:9/private",
    target: "source_site",
    captureScreenshots: false,
    enforcePublicUrlSafety: true
  });
  assert.equal(blockedRender.adapter, "fetch_fallback");
  assert.match(blockedRender.unavailableReason ?? "", /private|reserved/i);
  assert.equal(blockedRender.metrics.htmlBytes, 0);

  const migration = readFileSync("supabase/migrations/202607230007_canonical_website_assessments.sql", "utf8");
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /retired_prospect_report_jobs_not_empty/i);
  assert.match(migration, /completed_website_assessment_is_immutable/i);
  assert.match(migration, /website_assessments_payload_identity/i);
  assert.equal(existsSync("packages/acquisition/prospect-report-jobs.ts"), false);
  assert.equal(existsSync("lib/standard-evaluation.ts"), false);
  const publicAdapterSource = readFileSync("packages/website-assessment/public-url-adapter.ts", "utf8");
  const artifactAdapterSource = readFileSync("packages/website-assessment/site-artifact-adapter.ts", "utf8");
  for (const criterion of assessmentCriteria) {
    assert.match(publicAdapterSource, new RegExp(`["']${criterion.id.replaceAll(".", "\\.")}["']`), `Public URL adapter omitted ${criterion.id}.`);
    assert.match(artifactAdapterSource, new RegExp(`["']${criterion.id.replaceAll(".", "\\.")}["']`), `Artifact adapter omitted ${criterion.id}.`);
  }

  const crawlerPage = readFileSync("app/(marketing)/crawler/page.tsx", "utf8");
  assert.match(crawlerPage, /robots\.txt/);
  assert.match(crawlerPage, /does not.*submit third-party forms/is);
  assert.match(readFileSync(".env.example", "utf8"), /GOOGLE_CRUX_API_KEY=/);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    checks: [
      "rubric_weights",
      "coverage_gate",
      "critical_override",
      "findings_only_projection",
      "inferred_confidence_gate",
      "artifact_adapter",
      "calibration_guard",
      "immutable_retry_recovery",
      "public_browser_url_guard",
      "adapter_criterion_completeness",
      "queue_and_immutability",
      "crawler_disclosure"
    ]
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
