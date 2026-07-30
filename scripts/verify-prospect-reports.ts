import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyProspectWebsite,
  noOwnedWebsiteProspectReport,
  prospectReportFromAssessment,
  publicProspectReport,
  sourceKeyForNameAndLocality,
  sourceKeyForWebsite,
  withProspectScanSlot
} from "../packages/acquisition/prospect-reports";
import { prospectReportAccessTokenHash } from "../packages/acquisition/report-access";
import { sendProspectReportAccessEmail } from "../lib/prospect-report-email";
import {
  outboundReportQrSvg,
  outboundReportUrl
} from "../packages/acquisition/outbound-report-assets";
import {
  buildOutboundMailerManifest,
  outboundMailerManifestCsv
} from "../packages/acquisition/outbound";
import { publicProspectReportSchema } from "../packages/acquisition/public-report-contract";
import {
  prospectPresenceReportResultSchema,
  LocalPlatformOperationsRepository,
  type ProspectReportRecord
} from "../packages/platform-operations";
import { buildWebsiteAssessment } from "../packages/website-assessment/engine";
import { assessmentCriteria, assessmentDimensions } from "../packages/website-assessment/rubric";
import {
  agentReadinessCheck,
  agentReadinessCheckDefinitions
} from "../packages/website-assessment/agent-readiness";
import {
  buildVisualQuality,
  currentVisualQualityEvaluatorIdentity,
  visualEvidence,
  visualQualityPromptIdentity
} from "../packages/website-assessment/visual-quality";

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
  agentReadinessChecks: agentReadinessCheckDefinitions.map((definition) => agentReadinessCheck({
    id: definition.id,
    status: definition.id === "agent.basic.home_reachable" ? "fail" : definition.applicability === "capability" ? "not_applicable" : "pass",
    alignment: definition.id === "agent.basic.home_reachable" ? "present_invalid" : definition.applicability === "capability" ? "not_detected" : "present_valid",
    explanation: `${definition.title} fixture evidence.`,
    evidence: { id: `${definition.id}.fixture`, kind: "system", summary: "Agent fixture evidence.", observedAt: now }
  })),
  visualQuality: buildVisualQuality({
    observedAt: now,
    evaluator: {
      identity: currentVisualQualityEvaluatorIdentity(),
      status: "completed",
      provider: "openai",
      modelId: process.env.LODESTA_VISUAL_ASSESSMENT_MODEL?.trim() || "gpt-5.6-sol",
      promptIdentity: visualQualityPromptIdentity,
      screenshotSetHash: `sha256:${"a".repeat(64)}`,
      generatedAt: now,
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 50,
      durationMs: 250,
      estimatedCostUsd: 0.001
    },
    checks: [{
      id: "visual.hierarchy.primary_action",
      status: "warning",
      certainty: "inferred",
      confidence: 0.96,
      explanation: "The primary call-to-action has the same visual weight as secondary navigation choices.",
      evidence: [visualEvidence({
        id: "visual-primary-action",
        summary: "/ · mobile: The quote action uses the same size and treatment as secondary links.",
        observedAt: now,
        route: "/",
        viewport: "mobile",
        artifactKey: "/tmp/visual-primary-action.png",
        sourceUrl: "https://example.com/"
      })]
    }]
  }),
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
    assert.equal(owned.agentReadiness?.findings[0]?.id, "agent.basic.home_reachable");
    assert.match(owned.agentReadiness?.note ?? "", /not an official Cloudflare score/i);
    assert((owned.agentReadiness?.findings.length ?? 0) + (owned.agentReadiness?.verified.length ?? 0) <= 6);
    assert.doesNotMatch(JSON.stringify(owned.agentReadiness), /"grade"|"verdict"|"score"/);
    assert.equal(owned.visualQuality?.findings[0]?.id, "visual.hierarchy.primary_action");
    assert.match(owned.visualQuality?.note ?? "", /AI-assisted review/i);
    assert((owned.visualQuality?.findings.length ?? 0) + (owned.visualQuality?.strengths.length ?? 0) <= 4);
    assert.doesNotMatch(JSON.stringify(owned.visualQuality), /"grade"|"verdict"|"score"/);
    assert.equal(prospectPresenceReportResultSchema.safeParse({ ...owned, visualQuality: undefined }).success, false);
    assert.equal(prospectPresenceReportResultSchema.safeParse({ ...owned, score: 50 }).success, false);
  });

  record("gated_response_shape", "The teaser contains one complete finding while the full report never reaches an unauthorized browser.", () => {
    const base: ProspectReportRecord = {
      id: "prospect_report_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sourceKey: "url:test",
      accessPolicy: "email_gate",
      status: "completed",
      websiteKind: "owned_website",
      result: owned,
      createdAt: now,
      updatedAt: now,
      completedAt: now
    };
    const locked = publicProspectReport(base);
    assert.equal(publicProspectReportSchema.safeParse(locked).success, true);
    assert.equal(locked.createdAt, now);
    assert.equal(locked.updatedAt, now);
    assert.equal(locked.completedAt, now);
    assert.equal(locked.access.policy, "email_gate");
    assert.equal(locked.access.granted, false);
    assert.equal(locked.result, undefined);
    assert.equal(locked.teaser?.finding?.id, "functional.home_reachable");
    assert.match(locked.teaser?.finding?.recommendation ?? "", /restore/i);
    assert.doesNotMatch(JSON.stringify(locked), /visual-primary-action/);
    assert.doesNotMatch(JSON.stringify(locked), /"overallScore"|"overallLabel"|"verdict"/);
    const unlocked = publicProspectReport(base, { accessGranted: true });
    assert.equal(unlocked.access.granted, true);
    assert.ok(unlocked.result?.gatedPlan);
    const publicLink = publicProspectReport({ ...base, accessPolicy: "public_link" });
    assert.equal(publicLink.access.granted, true);
    assert.ok(publicLink.result?.findings.length);
    assert.equal(publicProspectReportSchema.safeParse({ ...locked, createdAt: undefined }).success, false);
    assert.equal(publicProspectReportSchema.safeParse({ ...locked, completedAt: undefined }).success, true);
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

  await recordAsync("visitor_access_grants", "Report policies never cross reuse boundaries, leads deduplicate by email, tokens fail closed across reports, and outbound views record once.", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lodesta-report-access-"));
    const statePath = join(directory, "operations.json");
    try {
      const local = new LocalPlatformOperationsRepository(statePath);
      const emailReport = await local.createProspectReport({
        id: "prospect_report_11111111111111111111111111111111",
        sourceKey: "url:shared",
        accessPolicy: "email_gate",
        websiteKind: "owned_website",
        sourceUrl: "https://example.com/"
      });
      const publicReport = await local.createProspectReport({
        id: "prospect_report_22222222222222222222222222222222",
        sourceKey: "url:shared",
        accessPolicy: "public_link",
        websiteKind: "owned_website",
        sourceUrl: "https://example.com/"
      });
      assert.equal((await local.findActiveProspectReportBySourceKey("url:shared", "email_gate"))?.id, emailReport.id);
      assert.equal((await local.findActiveProspectReportBySourceKey("url:shared", "public_link"))?.id, publicReport.id);

      const firstLead = await local.createProspectReportLead({
        reportId: emailReport.id,
        email: "Owner@Example.com"
      });
      const repeatedLead = await local.createProspectReportLead({
        reportId: emailReport.id,
        email: "owner@example.com"
      });
      assert(firstLead);
      assert.equal(repeatedLead?.id, firstLead.id);

      const secret = "report-access-secret-that-must-not-be-stored-raw";
      const tokenHash = prospectReportAccessTokenHash(secret);
      const grant = await local.createProspectReportAccessGrant({
        reportId: emailReport.id,
        leadId: firstLead.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      });
      assert.equal((await local.findActiveProspectReportAccessGrant(emailReport.id, tokenHash))?.id, grant.id);
      assert.equal(await local.findActiveProspectReportAccessGrant(publicReport.id, tokenHash), null);
      assert.equal(await local.findActiveProspectReportAccessGrant(emailReport.id, prospectReportAccessTokenHash("wrong")), null);
      const expiredHash = prospectReportAccessTokenHash("expired");
      await local.createProspectReportAccessGrant({
        reportId: emailReport.id,
        leadId: firstLead.id,
        tokenHash: expiredHash,
        expiresAt: new Date(Date.now() - 1_000).toISOString()
      });
      assert.equal(await local.findActiveProspectReportAccessGrant(emailReport.id, expiredHash), null);
      const stored = await readFile(statePath, "utf8");
      assert.doesNotMatch(stored, new RegExp(secret));
      assert.match(stored, /sha256:/);

      const campaign = await local.createOutboundCampaign({ name: "Report mail test" });
      const canonicalProspect = await local.upsertProspect({
        canonicalKey: "website:example.com",
        businessName: "Example Plumbing",
        status: "active",
        websiteKind: "owned_website",
        websiteUrl: "https://example.com/",
        countryCode: "US",
        doNotContact: false
      });
      const observation = await local.createProspectObservation({
        prospectId: canonicalProspect.id,
        sourceType: "business_website",
        sourceUrl: "https://example.com/",
        observedAt: new Date().toISOString(),
        websiteKind: "owned_website",
        websiteUrl: "https://example.com/",
        agencyStatus: "unknown",
        evidenceCoverage: 0.25,
        producer: "verify-prospect-reports",
        methodologyIdentity: "verify-prospect-reports-v1",
        inputHash: "verify:example-plumbing"
      });
      const prospect = await local.upsertOutboundProspect({
        prospectId: canonicalProspect.id,
        selectionObservationId: observation.id,
        campaignId: campaign.id,
      });
      await local.attachOutboundProspectReport(prospect.id, publicReport.id);
      assert.equal(await local.recordOutboundReportView(publicReport.id), true);
      assert.equal(await local.recordOutboundReportView(publicReport.id), false);
      assert.equal((await local.listOutboundEvents()).filter((event) => event.type === "report_viewed").length, 1);
      assert.ok((await local.getOutboundProspect(prospect.id))?.firstReportViewedAt);
      const manifest = buildOutboundMailerManifest(
        [campaign],
        await local.listOutboundProspects(),
        undefined,
        new Map(),
        new Map([[publicReport.id, {
          url: outboundReportUrl("https://lodesta.example", publicReport.id),
          status: publicReport.status
        }]])
      );
      assert.equal(manifest[0]?.reportStatus, "queued");
      assert.match(manifest[0]?.reportUrl ?? "", new RegExp(publicReport.id));
      assert.ok(manifest[0]?.firstReportViewedAt);
      assert.match(outboundMailerManifestCsv(manifest), /reportUrl,reportStatus/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  await recordAsync("report_email_delivery", "Missing configuration and provider success, failure, and timeout never block the access response.", async () => {
    const previousKey = process.env.RESEND_API_KEY;
    const previousFetch = globalThis.fetch;
    const input = {
      email: "owner@example.com",
      businessName: "Example Plumbing",
      reportUrl: "https://lodesta.example/website-health-report/prospect_report_test#access=secret"
    };
    try {
      delete process.env.RESEND_API_KEY;
      assert.equal((await sendProspectReportAccessEmail(input)).status, "skipped");
      process.env.RESEND_API_KEY = "test-key";
      globalThis.fetch = (async () => new Response(JSON.stringify({ id: "email_test" }), { status: 200 })) as typeof fetch;
      assert.equal((await sendProspectReportAccessEmail(input)).status, "sent");
      globalThis.fetch = (async () => new Response(JSON.stringify({ message: "rejected" }), { status: 500 })) as typeof fetch;
      assert.equal((await sendProspectReportAccessEmail(input)).status, "failed");
      globalThis.fetch = (async () => { throw new DOMException("Timed out", "TimeoutError"); }) as typeof fetch;
      assert.equal((await sendProspectReportAccessEmail(input)).status, "failed");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousKey;
    }
  });

  await recordAsync("outbound_qr_asset", "Outbound QR SVG generation uses only the canonical public report URL.", async () => {
    const canonical = outboundReportUrl(
      "https://lodesta.example/operator?ignored=true",
      "prospect_report_33333333333333333333333333333333"
    );
    assert.equal(
      canonical,
      "https://lodesta.example/website-health-report/prospect_report_33333333333333333333333333333333"
    );
    const svg = await outboundReportQrSvg(canonical);
    assert.match(svg, /^<svg/);
    assert.match(svg, /viewBox=/);
    assert.doesNotMatch(svg, /access=|token=|secret=/i);
  });

  await recordAsync("outbound_report_authority", "Only the admin report route can assign or revoke public-link access, and the QR route is admin-protected.", async () => {
    const [reportRoute, qrRoute, publicCreateRoute] = await Promise.all([
      readFile("app/api/outbound/prospects/[prospectId]/report/route.ts", "utf8"),
      readFile("app/api/outbound/prospects/[prospectId]/report/qr/route.ts", "utf8"),
      readFile("app/api/prospect-reports/route.ts", "utf8")
    ]);
    assert.match(reportRoute, /requireAdmin\(request\)/);
    assert.match(reportRoute, /accessPolicy: "public_link"/);
    assert.match(reportRoute, /accessPolicy: "email_gate"/);
    assert.match(reportRoute, /if \(!prospect\.sourceUrl\)/);
    assert.match(qrRoute, /requireAdmin\(request\)/);
    assert.match(qrRoute, /outboundReportQrSvg\(reportUrl\)/);
    assert.match(publicCreateRoute, /accessPolicy: "email_gate"/);
    assert.doesNotMatch(publicCreateRoute, /parsed\.data\.accessPolicy/);
  });

  process.stdout.write(`${JSON.stringify({ ok: true, checks }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
