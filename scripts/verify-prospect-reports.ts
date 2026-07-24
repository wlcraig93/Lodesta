import assert from "node:assert/strict";
import {
  classifyProspectWebsite,
  noOwnedWebsiteProspectReport,
  prospectReportFromAssessment,
  publicProspectReport,
  sourceKeyForNameAndLocality,
  sourceKeyForWebsite,
  withProspectScanSlot
} from "../packages/acquisition/prospect-reports";
import {
  prospectPresenceReportResultSchema,
  type ProspectReportRecord
} from "../packages/platform-operations";
import { buildWebsiteAssessment } from "../packages/website-assessment/engine";
import { assessmentCriteria, assessmentDimensions } from "../packages/website-assessment/rubric";

type CheckResult = { name: string; ok: true; detail: string };
const checks: CheckResult[] = [];
const now = new Date().toISOString();

function record(name: string, detail: string, fn: () => void) {
  fn();
  checks.push({ name, ok: true, detail });
}

async function recordAsync(name: string, detail: string, fn: () => Promise<void>) {
  await fn();
  checks.push({ name, ok: true, detail });
}

const assessment = buildWebsiteAssessment({
  id: "website_assessment_test",
  target: { kind: "public_url", sourceKey: "url:test", sourceUrl: "https://example.com/" },
  siteUnderstanding: {
    businessName: "Example Business",
    services: ["Repairs"],
    vertical: "general_local",
    verticalConfidence: 0.35,
    verticalEvidence: ["No strong vertical evidence."],
    customerJourneys: ["Call the business"]
  },
  criteria: [{
    id: "functional.home_reachable",
    dimensionId: "functional_integrity",
    title: "Homepage returns a usable response",
    status: "fail",
    impact: "critical",
    certainty: "deterministic",
    applicability: "universal",
    explanation: "The homepage returned HTTP 500.",
    businessConsequence: "Unavailable pages lose customers.",
    recommendation: "Restore the homepage.",
    evidence: [{ id: "home", kind: "http", summary: "HTTP 500.", observedAt: now }]
  }],
  inputHashSource: { fixture: true },
  generatedAt: now
});

async function main() {
  record("canonical_rubric", "The canonical rubric has unique criteria and seven dimensions totaling 100% weight.", () => {
    assert.equal(new Set(assessmentCriteria.map((criterion) => criterion.id)).size, assessmentCriteria.length);
    assert.equal(assessmentDimensions.length, 7);
    assert.equal(assessmentDimensions.reduce((total, dimension) => total + dimension.weight, 0), 100);
    const vertical = assessment.dimensions.flatMap((dimension) => dimension.criteria).find((criterion) => criterion.id === "local_content.vertical_requirements");
    assert.equal(vertical?.status, "not_applicable", "low-confidence vertical criteria must not penalize the site");
  });

  record("website_classification", "Owned, missing, social, and aggregator URLs route to the expected variant.", () => {
    assert.equal(classifyProspectWebsite(undefined).kind, "no_website");
    assert.equal(classifyProspectWebsite("https://www.facebook.com/oakhillbodyworks").kind, "social_or_aggregator");
    assert.equal(classifyProspectWebsite("https://linktr.ee/example-business").kind, "social_or_aggregator");
    assert.equal(classifyProspectWebsite("https://www.yelp.com/biz/example").kind, "social_or_aggregator");
    assert.equal(classifyProspectWebsite("lodesta.com").kind, "owned_website");
  });

  const noWebsiteResult = noOwnedWebsiteProspectReport({ websiteKind: "no_website" });
  record("no_owned_website_report", "Missing websites get a concrete finding without a fabricated score or verdict.", () => {
    assert.equal(noWebsiteResult.kind, "prospect-presence-report");
    assert.equal(noWebsiteResult.schemaVersion, 1);
    assert.equal(noWebsiteResult.findings[0]?.id, "no_owned_website");
    assert.equal("overallScore" in noWebsiteResult, false);
    assert.equal("overallLabel" in noWebsiteResult, false);
  });

  const owned = prospectReportFromAssessment(assessment);
  record("findings_only_projection", "Public reports expose reasons and evidence but not internal composite fields.", () => {
    assert.equal(prospectPresenceReportResultSchema.safeParse(owned).success, true);
    assert.equal(owned.findings[0]?.id, "functional.home_reachable");
    assert.match(owned.findings[0]?.evidence[0] ?? "", /HTTP 500/);
    const serialized = JSON.stringify(owned);
    assert.doesNotMatch(serialized, /"score"|"verdict"|"pointsEarned"|"pointsPossible"/);
    assert.equal(prospectPresenceReportResultSchema.safeParse({ ...owned, score: 50 }).success, false);
  });

  record("gated_response_shape", "The detailed plan remains gated while findings stay visible.", () => {
    const base: ProspectReportRecord = {
      id: "prospect_report_test",
      sourceKey: "url:test",
      status: "completed",
      websiteKind: "owned_website",
      result: owned,
      createdAt: now,
      updatedAt: now,
      completedAt: now
    };
    const locked = publicProspectReport(base);
    assert.equal(locked.result?.gatedPlan, undefined);
    assert.ok(locked.result?.findings.length);
    const unlocked = publicProspectReport({ ...base, unlockedAt: now });
    assert.ok(unlocked.result?.gatedPlan);
  });

  await recordAsync("scan_concurrency_guard", "Nested scans are rejected when the process scan limit is reached.", async () => {
    const previous = process.env.LODESTA_PROSPECT_REPORT_SCAN_CONCURRENCY;
    process.env.LODESTA_PROSPECT_REPORT_SCAN_CONCURRENCY = "1";
    let blocked = false;
    await withProspectScanSlot(async () => {
      try {
        await withProspectScanSlot(async () => undefined);
      } catch {
        blocked = true;
      }
    });
    if (previous === undefined) delete process.env.LODESTA_PROSPECT_REPORT_SCAN_CONCURRENCY;
    else process.env.LODESTA_PROSPECT_REPORT_SCAN_CONCURRENCY = previous;
    assert.equal(blocked, true);
  });

  record("source_keys", "URL and normalized name/locality inputs produce stable source keys.", () => {
    assert.equal(sourceKeyForWebsite("http://www.Example.com/?tracking=1"), sourceKeyForWebsite("https://example.com/"));
    assert.equal(sourceKeyForNameAndLocality("Café Plumbing", "Austin, TX"), sourceKeyForNameAndLocality("Café  Plumbing", "Austin, TX"));
    assert.notEqual(sourceKeyForNameAndLocality("Café Plumbing", "Austin, TX"), sourceKeyForNameAndLocality("Café Plumbing", "Dallas, TX"));
  });

  process.stdout.write(`${JSON.stringify({ ok: true, checks }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
