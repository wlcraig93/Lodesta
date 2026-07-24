import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";
import { sha256 } from "../packages/business-data";
import {
  platformSiteRecordSchema,
  siteBuildArtifactSchema,
  siteVersionSchema
} from "../packages/site-contracts";
import { siteToolchainIdentity } from "../packages/site-contracts/platform-manifest";
import { assessSiteArtifact } from "../packages/website-assessment/site-artifact-adapter";
import { buildWebsiteAssessment } from "../packages/website-assessment/engine";
import { publicWebsiteAssessmentProjection } from "../packages/website-assessment/public-projection";
import { assessmentCriteria, assessmentDimensions } from "../packages/website-assessment/rubric";
import { summarizeAssessmentCalibration } from "../packages/website-assessment/calibration";
import {
  agentReadinessCheck,
  agentReadinessCheckDefinitions
} from "../packages/website-assessment/agent-readiness";
import { agentReadinessForPublicUrl } from "../packages/website-assessment/agent-readiness-adapters";
import {
  collectAgentReadinessProbes,
  findProbe,
  validJsonProbe,
  type AgentReadinessProbeResult
} from "../packages/website-assessment/agent-readiness-probes";
import {
  websiteAssessmentSchema,
  type AgentReadinessCheckInput,
  type AssessmentCriterionInput
} from "../packages/website-assessment/contracts";
import { processNextWebsiteAssessmentJob } from "../packages/website-assessment/jobs";
import { persistWebsiteAssessmentEvidence } from "../packages/website-assessment/evidence-storage";
import {
  enqueuePublishedSiteAssessment,
  websiteAssessmentRecordIsCurrent
} from "../packages/website-assessment/service";
import { inspectUrlRender } from "../lib/render-inspection";
import {
  evaluateVisualQuality,
  type VisualQualityResponsesClient
} from "../packages/website-assessment/visual-quality-evaluator";
import {
  publiclyEligibleVisualQualityCheckIds,
  visualQualityCheckDefinitions,
  visualQualityMethodologyIdentity
} from "../packages/website-assessment/visual-quality";
import { selectVisualQualityPages } from "../packages/website-assessment/visual-quality-capture";
import { evaluateArtifactVisualQuality } from "../packages/website-assessment/visual-quality-artifact";
import type {
  PlatformOperationsRepository,
  ProspectReportRecord,
  WebsiteAssessmentJob,
  WebsiteAssessmentRecord
} from "../packages/platform-operations";
import type { CrawlAssessment } from "../lib/crawler";
import type { WebsiteGenerationIngestion } from "../packages/business-data/generation-crawler";

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

function agentCheckInput(
  statusFor: (id: string) => AgentReadinessCheckInput["status"] = () => "pass"
) {
  return agentReadinessCheckDefinitions.map((definition) => agentReadinessCheck({
    id: definition.id,
    status: statusFor(definition.id),
    alignment: statusFor(definition.id) === "pass" ? "present_valid" : statusFor(definition.id) === "unknown" ? "not_tested" : "not_detected",
    explanation: `${definition.title} fixture evidence.`,
    evidence: { id: `${definition.id}.fixture`, kind: "system", summary: "Agent fixture evidence.", observedAt }
  }));
}

function visualEvaluatorClient(input: {
  statusFor?: (id: string) => "pass" | "warning" | "fail" | "unknown" | "not_applicable";
  explanationFor?: (id: string) => string;
  routeFor?: (id: string) => string;
  confidenceFor?: (id: string) => number;
} = {}): VisualQualityResponsesClient {
  return {
    async create() {
      return {
        status: "completed",
        output_text: JSON.stringify({
          checks: visualQualityCheckDefinitions.map((definition) => {
            const status = input.statusFor?.(definition.id) ?? "pass";
            return {
              id: definition.id,
              status,
              confidence: input.confidenceFor?.(definition.id) ?? 0.95,
              explanation: input.explanationFor?.(definition.id) ?? `${definition.title} is supported by the retained screenshots.`,
              evidence: status === "unknown" || status === "not_applicable"
                ? []
                : [{
                    route: input.routeFor?.(definition.id) ?? "/",
                    viewport: "desktop",
                    observation: `The desktop screenshot visibly supports ${definition.title.toLowerCase()}.`
                  }]
            };
          })
        }),
        usage: {
          input_tokens: 1_000,
          input_tokens_details: { cached_tokens: 100 },
          output_tokens: 500
        }
      };
    }
  };
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

function crawlFixture(input: {
  verticalText?: boolean;
  linkHref?: string;
  linkKind?: "internal" | "external" | "booking" | "ordering" | "social";
} = {}) {
  const homepageText = `Northstar Collision Repair serves Austin, Texas. Call 512-555-0100 for collision repair estimates. ${"Detailed repair process and customer guidance. ".repeat(10)}`;
  return {
    url: "https://93.184.216.34/",
    finalUrl: "https://93.184.216.34/",
    fetched: true,
    status: 200,
    title: "Northstar Collision Repair",
    sitemapFound: true,
    extractedFacts: {
      name: "Northstar Collision Repair",
      phone: "512-555-0100",
      address: { street: "100 Main St", city: "Austin", region: "TX", postalCode: "78701" },
      serviceAreas: ["Austin, TX"],
      services: ["Collision Repair"]
    },
    pageSummaries: [
      {
        url: "https://93.184.216.34/",
        source: "primary",
        title: "Northstar Collision Repair",
        canonical: "https://93.184.216.34/",
        mainText: homepageText,
        purposeTags: [],
        linkReferences: input.linkHref ? [{ href: input.linkHref, kind: input.linkKind ?? "ordering" }] : []
      },
      {
        url: "https://93.184.216.34/collision-repair",
        source: "linked",
        title: "Collision Repair in Austin",
        canonical: "https://93.184.216.34/collision-repair",
        mainText: `What does collision repair include? We repair verified body and paint damage. How long does a repair take? Timing depends on damage and parts. ${"Repair scope, process, timing, and estimate guidance. ".repeat(12)}`,
        purposeTags: ["service_detail"],
        linkReferences: []
      },
      {
        url: "https://93.184.216.34/location",
        source: "linked",
        title: "Austin Shop Location",
        canonical: "https://93.184.216.34/location",
        mainText: `Where is the repair shop? Visit Northstar Collision Repair at 100 Main St, Austin, TX 78701. ${"Hours, arrival details, parking, and contact guidance. ".repeat(10)}`,
        purposeTags: ["location"],
        linkReferences: []
      }
    ]
  } as unknown as CrawlAssessment;
}

function ingestionFixture() {
  return { coverage: "complete" } as unknown as WebsiteGenerationIngestion;
}

function withoutCapabilities(result: AgentReadinessProbeResult) {
  const copy = structuredClone(result);
  copy.capabilities = { api: false, oauth: false, mcp: false, agent: false, webMcp: false, x402: false };
  for (const probe of copy.probes) {
    if (["web_bot_auth", "agent_skills", "api_catalog", "oauth_authorization_server", "oauth_protected_resource", "mcp_server_card", "ucp", "acp"].includes(probe.id)) {
      Object.assign(probe, { status: 404, ok: false, contentType: "text/html", body: "Not found" });
    }
  }
  return copy;
}

async function main() {
  assert.equal(assessmentDimensions.reduce((total, dimension) => total + dimension.weight, 0), 100);
  assert.equal(new Set(assessmentCriteria.map((criterion) => criterion.id)).size, assessmentCriteria.length);
  assert.equal(new Set(visualQualityCheckDefinitions.map((check) => check.id)).size, visualQualityCheckDefinitions.length);
  assert.equal(visualQualityCheckDefinitions.length, 13);
  assert(visualQualityCheckDefinitions.every((check) => ["major", "minor", "advisory"].includes(check.impact)));
  assert([...publiclyEligibleVisualQualityCheckIds].every((id) => visualQualityCheckDefinitions.some((check) => check.id === id)));
  const visualScreenshots = [
    { route: "/", viewport: "desktop" as const, artifactKey: ".data/render-inspections/fixture/desktop.png", sourceUrl: "https://strong.example/" },
    { route: "/", viewport: "mobile" as const, artifactKey: ".data/render-inspections/fixture/mobile.png", sourceUrl: "https://strong.example/" }
  ];
  const strongVisualQuality = await evaluateVisualQuality({
    contactSheet: Buffer.from("visual fixture"),
    screenshots: visualScreenshots,
    vertical: understanding.vertical,
    verticalConfidence: understanding.verticalConfidence,
    businessName: understanding.businessName,
    primaryLocation: understanding.primaryLocation,
    services: understanding.services,
    customerJourneys: understanding.customerJourneys,
    deterministicContext: { fixture: "strong" },
    hasMeaningfulImagery: true,
    observedAt,
    client: visualEvaluatorClient()
  });
  const adverseVisualQuality = await evaluateVisualQuality({
    contactSheet: Buffer.from("visual adverse fixture"),
    screenshots: visualScreenshots,
    vertical: understanding.vertical,
    verticalConfidence: understanding.verticalConfidence,
    businessName: understanding.businessName,
    primaryLocation: understanding.primaryLocation,
    services: understanding.services,
    customerJourneys: understanding.customerJourneys,
    deterministicContext: { fixture: "adverse" },
    hasMeaningfulImagery: true,
    observedAt,
    client: visualEvaluatorClient({ statusFor: () => "fail" })
  });

  const strong = buildWebsiteAssessment({
    id: "website_assessment_strong",
    target: { kind: "public_url", sourceKey: "url:strong", sourceUrl: "https://strong.example/" },
    siteUnderstanding: understanding,
    criteria: criterionInput(() => "pass"),
    agentReadinessChecks: agentCheckInput(),
    visualQuality: strongVisualQuality,
    inputHashSource: { fixture: "strong" },
    generatedAt: observedAt
  });
  assert.equal(strong.coverage.value, 1);
  assert.equal(strong.score?.verdict, "strong");
  assert.match(strong.agentReadiness.methodologyIdentity, /^agent-readiness@sha256:[a-f0-9]{64}$/);
  assert.equal(strong.agentReadiness.groups.length, 7);
  assert.equal(strong.agentReadiness.groups.flatMap((group) => group.checks).length, agentReadinessCheckDefinitions.length);
  assert.equal(strong.agentReadiness.counts.verified, agentReadinessCheckDefinitions.length);
  assert.equal(websiteAssessmentSchema.safeParse({ ...strong, agentReadiness: undefined }).success, false);
  assert.match(strong.visualQuality.methodologyIdentity, /^visual-quality@sha256:[a-f0-9]{64}$/);
  assert.equal(strong.visualQuality.groups.flatMap((group) => group.checks).length, visualQualityCheckDefinitions.length);
  assert.equal(strong.visualQuality.counts.verified, visualQualityCheckDefinitions.length);
  assert.equal(websiteAssessmentSchema.safeParse({ ...strong, visualQuality: undefined }).success, false);

  const visuallyAdverse = buildWebsiteAssessment({
    id: "website_assessment_visual_adverse",
    target: { kind: "public_url", sourceKey: "url:visual-adverse", sourceUrl: "https://visual-adverse.example/" },
    siteUnderstanding: understanding,
    criteria: criterionInput(() => "pass"),
    agentReadinessChecks: agentCheckInput(),
    visualQuality: adverseVisualQuality,
    inputHashSource: { fixture: "visual-adverse" },
    generatedAt: observedAt
  });
  assert.equal(visuallyAdverse.score?.value, strong.score?.value, "Visual Quality changed the objective composite.");
  assert.equal(visuallyAdverse.score?.verdict, strong.score?.verdict, "Visual Quality changed the objective verdict.");

  const adverseAgentReadiness = buildWebsiteAssessment({
    id: "website_assessment_agent_adverse",
    target: { kind: "public_url", sourceKey: "url:agent-adverse", sourceUrl: "https://agent-adverse.example/" },
    siteUnderstanding: understanding,
    criteria: criterionInput(() => "pass"),
    agentReadinessChecks: agentCheckInput(() => "fail"),
    inputHashSource: { fixture: "agent-adverse" },
    generatedAt: observedAt
  });
  assert.equal(adverseAgentReadiness.score?.value, strong.score?.value, "Agent Readiness must not change the canonical website composite");
  assert.equal(adverseAgentReadiness.score?.verdict, strong.score?.verdict, "Agent Readiness must not change the canonical website verdict");

  const criticalFailure = buildWebsiteAssessment({
    id: "website_assessment_critical",
    target: { kind: "public_url", sourceKey: "url:critical", sourceUrl: "https://critical.example/" },
    siteUnderstanding: understanding,
    criteria: criterionInput((id) => id === "functional.home_reachable" ? "fail" : "pass"),
    agentReadinessChecks: agentCheckInput((id) => id === "agent.basic.home_reachable" ? "fail" : "pass"),
    inputHashSource: { fixture: "critical" },
    generatedAt: observedAt
  });
  assert.equal(criticalFailure.score?.verdict, "poor", "critical failures must override the numeric score band");

  const lowCoverage = buildWebsiteAssessment({
    id: "website_assessment_low_coverage",
    target: { kind: "public_url", sourceKey: "url:unknown", sourceUrl: "https://unknown.example/" },
    siteUnderstanding: { ...understanding, vertical: "general_local", verticalConfidence: 0.35 },
    criteria: [],
    agentReadinessChecks: agentCheckInput(() => "unknown"),
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
  const adversePublicAgentFindings = publicWebsiteAssessmentProjection(adverseAgentReadiness).agentReadiness.findings;
  assert.equal(adversePublicAgentFindings.some((finding) => finding.id.startsWith("agent.protocol.") || finding.id.startsWith("agent.commerce.")), false, "raw advanced-protocol noise must remain internal");
  const adverseVisualProjection = publicWebsiteAssessmentProjection(visuallyAdverse).visualQuality;
  assert(adverseVisualProjection.findings.length > 0, "high-confidence screenshot-grounded visual findings must project publicly");
  assert(adverseVisualProjection.findings.length + adverseVisualProjection.strengths.length <= 4);
  assert.equal(adverseVisualProjection.findings.some((finding) => finding.id === "visual.brand.coherence" || finding.id === "visual.trust.vertical_fit"), false, "subjective brand and vertical-fit checks must remain internal");
  assert.match(adverseVisualProjection.note, /AI-assisted/i);
  assert.doesNotMatch(JSON.stringify(adverseVisualProjection), /"score"|"grade"|"verdict"/);

  const lowConfidenceVisual = await evaluateVisualQuality({
    contactSheet: Buffer.from("visual low-confidence fixture"),
    screenshots: visualScreenshots,
    vertical: understanding.vertical,
    verticalConfidence: understanding.verticalConfidence,
    businessName: understanding.businessName,
    primaryLocation: understanding.primaryLocation,
    services: understanding.services,
    customerJourneys: understanding.customerJourneys,
    deterministicContext: { fixture: "low-confidence" },
    hasMeaningfulImagery: true,
    observedAt,
    client: visualEvaluatorClient({
      statusFor: () => "warning",
      confidenceFor: () => 0.89
    })
  });
  const lowConfidenceVisualAssessment = buildWebsiteAssessment({
    id: "website_assessment_visual_low_confidence",
    target: { kind: "public_url", sourceKey: "url:visual-low-confidence", sourceUrl: "https://visual-low-confidence.example/" },
    siteUnderstanding: understanding,
    criteria: criterionInput(() => "pass"),
    agentReadinessChecks: agentCheckInput(),
    visualQuality: lowConfidenceVisual,
    inputHashSource: { fixture: "visual-low-confidence" },
    generatedAt: observedAt
  });
  assert.equal(publicWebsiteAssessmentProjection(lowConfidenceVisualAssessment).visualQuality.findings.length, 0, "visual findings below 0.90 confidence must remain internal");

  const invalidVisualCitation = await evaluateVisualQuality({
    contactSheet: Buffer.from("invalid visual citation"),
    screenshots: visualScreenshots,
    vertical: understanding.vertical,
    verticalConfidence: understanding.verticalConfidence,
    services: understanding.services,
    customerJourneys: understanding.customerJourneys,
    deterministicContext: {},
    hasMeaningfulImagery: true,
    observedAt,
    client: visualEvaluatorClient({ routeFor: () => "/missing" })
  });
  assert.equal(invalidVisualCitation.evaluator.status, "unavailable");
  const prohibitedVisualLanguage = await evaluateVisualQuality({
    contactSheet: Buffer.from("prohibited visual language"),
    screenshots: visualScreenshots,
    vertical: understanding.vertical,
    verticalConfidence: understanding.verticalConfidence,
    services: understanding.services,
    customerJourneys: understanding.customerJourneys,
    deterministicContext: {},
    hasMeaningfulImagery: true,
    observedAt,
    client: visualEvaluatorClient({ explanationFor: () => "The site looks dated." })
  });
  assert.equal(prohibitedVisualLanguage.evaluator.status, "unavailable");
  const prohibitedVisualAssertion = await evaluateVisualQuality({
    contactSheet: Buffer.from("prohibited visual assertion"),
    screenshots: visualScreenshots,
    vertical: understanding.vertical,
    verticalConfidence: understanding.verticalConfidence,
    services: understanding.services,
    customerJourneys: understanding.customerJourneys,
    deterministicContext: {},
    hasMeaningfulImagery: true,
    observedAt,
    client: visualEvaluatorClient({ explanationFor: () => "The page loads slowly and will have a poor LCP." })
  });
  assert.equal(prohibitedVisualAssertion.evaluator.status, "unavailable");
  const invalidVisualApplicability = await evaluateVisualQuality({
    contactSheet: Buffer.from("invalid visual applicability"),
    screenshots: visualScreenshots,
    vertical: understanding.vertical,
    verticalConfidence: understanding.verticalConfidence,
    services: understanding.services,
    customerJourneys: understanding.customerJourneys,
    deterministicContext: {},
    hasMeaningfulImagery: true,
    observedAt,
    client: visualEvaluatorClient({
      statusFor: (id) => id === "visual.hierarchy.value_proposition" ? "not_applicable" : "pass"
    })
  });
  assert.equal(invalidVisualApplicability.evaluator.status, "unavailable");
  const malformedVisualOutput = await evaluateVisualQuality({
    contactSheet: Buffer.from("malformed visual output"),
    screenshots: visualScreenshots,
    vertical: understanding.vertical,
    verticalConfidence: understanding.verticalConfidence,
    services: understanding.services,
    customerJourneys: understanding.customerJourneys,
    deterministicContext: {},
    hasMeaningfulImagery: true,
    observedAt,
    client: { async create() { return { status: "completed", output_text: "{}" }; } }
  });
  assert.equal(malformedVisualOutput.evaluator.status, "unavailable");
  const providerFailureVisual = await evaluateVisualQuality({
    contactSheet: Buffer.from("provider failure"),
    screenshots: visualScreenshots,
    vertical: understanding.vertical,
    verticalConfidence: understanding.verticalConfidence,
    services: understanding.services,
    customerJourneys: understanding.customerJourneys,
    deterministicContext: {},
    hasMeaningfulImagery: true,
    observedAt,
    client: { async create() { throw new Error("provider unavailable"); } }
  });
  assert.equal(providerFailureVisual.evaluator.status, "unavailable");
  const timeoutVisual = await evaluateVisualQuality({
    contactSheet: Buffer.from("timeout"),
    screenshots: visualScreenshots,
    vertical: understanding.vertical,
    verticalConfidence: understanding.verticalConfidence,
    services: understanding.services,
    customerJourneys: understanding.customerJourneys,
    deterministicContext: {},
    hasMeaningfulImagery: true,
    observedAt,
    client: { async create() { throw new DOMException("fixture timeout", "TimeoutError"); } }
  });
  assert.equal(timeoutVisual.evaluator.status, "unavailable");
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const missingConfigurationVisual = await evaluateVisualQuality({
    contactSheet: Buffer.from("missing configuration"),
    screenshots: visualScreenshots,
    vertical: understanding.vertical,
    verticalConfidence: understanding.verticalConfidence,
    services: understanding.services,
    customerJourneys: understanding.customerJourneys,
    deterministicContext: {},
    hasMeaningfulImagery: true,
    observedAt
  });
  if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousOpenAiKey;
  assert.equal(missingConfigurationVisual.evaluator.status, "unavailable");
  assert.match(missingConfigurationVisual.coverage.limitations.join(" "), /not configured/i);
  const missingVisualEvidence = await evaluateVisualQuality({
    screenshots: [],
    vertical: understanding.vertical,
    verticalConfidence: understanding.verticalConfidence,
    services: understanding.services,
    customerJourneys: understanding.customerJourneys,
    deterministicContext: {},
    hasMeaningfulImagery: false,
    observedAt
  });
  assert.equal(missingVisualEvidence.evaluator.status, "unavailable");
  assert.equal(missingVisualEvidence.counts.unknown, visualQualityCheckDefinitions.length);
  const missingDeliveryAssessment = structuredClone(strong);
  for (const check of missingDeliveryAssessment.visualQuality.groups.flatMap((group) => group.checks)) {
    for (const item of check.evidence) {
      if (item.artifactKey) {
        item.artifactKey = ".data/render-inspections/intentionally-missing/visual.png";
      }
    }
  }
  const missingDeliveryResult = await persistWebsiteAssessmentEvidence({
    assessment: missingDeliveryAssessment,
    store: {
      async putImmutable() {
        throw new Error("Missing local screenshots must not be written.");
      },
      async get() {
        return undefined;
      },
      async exists() {
        return false;
      }
    }
  });
  assert.match(
    missingDeliveryResult.visualQuality.coverage.limitations.join(" "),
    /Visual Quality screenshot.*unavailable for immutable delivery/i
  );
  assert.equal(
    missingDeliveryResult.visualQuality.groups
      .flatMap((group) => group.checks)
      .flatMap((check) => check.evidence)
      .some((item) => item.artifactKey),
    false,
    "unavailable local screenshot paths must not survive immutable persistence"
  );

  const applicabilityVisual = await evaluateVisualQuality({
    contactSheet: Buffer.from("visual applicability fixture"),
    screenshots: [visualScreenshots[0]],
    vertical: "general_local",
    verticalConfidence: 0.35,
    services: [],
    customerJourneys: [],
    deterministicContext: {},
    hasMeaningfulImagery: false,
    observedAt,
    client: visualEvaluatorClient()
  });
  const applicabilityChecks = applicabilityVisual.groups.flatMap((group) => group.checks);
  assert.equal(applicabilityChecks.find((check) => check.id === "visual.imagery.relevance_quality")?.status, "not_applicable");
  assert.equal(applicabilityChecks.find((check) => check.id === "visual.trust.vertical_fit")?.status, "not_applicable");
  assert.equal(applicabilityChecks.find((check) => check.id === "visual.responsive.cross_viewport_consistency")?.status, "unknown");
  assert.deepEqual(selectVisualQualityPages(crawlFixture()).map((page) => new URL(page.url).pathname), ["/", "/collision-repair", "/location"]);

  const lowConfidenceInference = buildWebsiteAssessment({
    id: "website_assessment_low_confidence_inference",
    target: { kind: "public_url", sourceKey: "url:inference", sourceUrl: "https://inference.example/" },
    siteUnderstanding: understanding,
    criteria: criterionInput((id) => id === "trust.proof" ? "warning" : "pass").map((criterion) => (
      criterion.id === "trust.proof" ? { ...criterion, confidence: 0.7 } : criterion
    )),
    agentReadinessChecks: agentCheckInput(),
    inputHashSource: { fixture: "low-confidence-inference" },
    generatedAt: observedAt
  });
  assert.equal(
    publicWebsiteAssessmentProjection(lowConfidenceInference).findings.some((finding) => finding.id === "trust.proof"),
    false,
    "inferred findings below the public confidence threshold must remain internal"
  );

  const lowConfidenceAgentChecks = agentCheckInput().map((check) => (
    check.id === "agent.answer.direct_answers"
      ? {
          ...check,
          status: "warning" as const,
          alignment: "present_invalid" as const,
          certainty: "inferred" as const,
          confidence: 0.7
        }
      : check
  ));
  const lowConfidenceAgentAssessment = buildWebsiteAssessment({
    id: "website_assessment_agent_low_confidence",
    target: { kind: "public_url", sourceKey: "url:agent-inference", sourceUrl: "https://agent-inference.example/" },
    siteUnderstanding: understanding,
    criteria: criterionInput(() => "pass"),
    agentReadinessChecks: lowConfidenceAgentChecks,
    inputHashSource: { fixture: "agent-low-confidence" },
    generatedAt: observedAt
  });
  assert.equal(
    publicWebsiteAssessmentProjection(lowConfidenceAgentAssessment).agentReadiness.findings.some((finding) => finding.id === "agent.answer.direct_answers"),
    false,
    "inferred Agent Readiness findings below 0.85 confidence must remain internal"
  );

  const observedUserAgents: string[] = [];
  const fetchedReadiness = await collectAgentReadinessProbes({
    url: "https://93.184.216.34/",
    fetchImpl: (async (request, init) => {
      const url = new URL(String(request));
      observedUserAgents.push(new Headers(init?.headers).get("user-agent") ?? "");
      if (url.pathname === "/robots.txt") {
        return new Response(
          "User-agent: *\nAllow: /\nContent-Signal: search=yes, ai-input=yes, ai-train=no\n\nUser-agent: GPTBot\nDisallow: /\n",
          { status: 200, headers: { "content-type": "text/plain" } }
        );
      }
      if (url.pathname === "/" && new Headers(init?.headers).get("accept")?.includes("text/markdown")) {
        return new Response("# Northstar Collision Repair\n\nCollision Repair at 100 Main St, Austin, TX, 78701. Call 512-555-0100.\n", {
          status: 200,
          headers: {
            "content-type": "text/markdown",
            link: '<https://93.184.216.34/>; rel="canonical"'
          }
        });
      }
      if (url.pathname === "/") {
        return new Response(
          '<main><h1>Northstar Collision Repair</h1><p>Collision Repair in Austin, TX. Call 512-555-0100.</p></main><script type="application/ld+json">{"@type":"LocalBusiness","name":"Northstar Collision Repair","telephone":"512-555-0100","address":{"streetAddress":"100 Main St","addressLocality":"Austin","addressRegion":"TX","postalCode":"78701"}}</script>',
          {
            status: 200,
            headers: {
              "content-type": "text/html",
              link: '<https://93.184.216.34/index.md>; rel="alternate"; type="text/markdown"'
            }
          }
        );
      }
      if (url.pathname === "/llms.txt") {
        return new Response("# Northstar Collision Repair\n\n- [Homepage](https://93.184.216.34/index.md)\n", {
          status: 200,
          headers: { "content-type": "text/plain" }
        });
      }
      if (url.pathname === "/.well-known/api-catalog") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://93.184.216.34/.well-known/api-catalog.json" }
        });
      }
      const discoveryDocuments: Record<string, unknown> = {
        "/.well-known/http-message-signatures-directory": { keys: [{ id: "fixture-key" }] },
        "/.well-known/agent-skills/index.json": { skills: [{ name: "estimate", url: "https://93.184.216.34/skills/estimate" }] },
        "/.well-known/api-catalog.json": { linkset: [{ anchor: "https://93.184.216.34/", "service-desc": [{ href: "https://93.184.216.34/openapi.json" }] }] },
        "/.well-known/oauth-authorization-server": { issuer: "https://93.184.216.34/", authorization_endpoint: "https://93.184.216.34/authorize" },
        "/.well-known/oauth-protected-resource": { resource: "https://93.184.216.34/api", authorization_servers: ["https://93.184.216.34/"] },
        "/.well-known/mcp/server-card.json": { serverInfo: { name: "fixture" }, transport: { type: "streamable-http", endpoint: "/mcp" } },
        "/.well-known/ucp": { version: "2026", services: [{ name: "checkout" }] },
        "/.well-known/acp": { version: "2026", capabilities: ["checkout"] }
      };
      return new Response(JSON.stringify(discoveryDocuments[url.pathname] ?? {}), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch
  });
  assert.equal(fetchedReadiness.probes.length, 12);
  assert.equal(findProbe(fetchedReadiness, "api_catalog")?.finalUrl, "https://93.184.216.34/.well-known/api-catalog.json");
  assert.equal(fetchedReadiness.robots.contentSignals?.aiInput, "yes");
  assert.deepEqual(fetchedReadiness.robots.aiAgents, ["GPTBot"]);
  assert(observedUserAgents.every((userAgent) => /LodestaGenerationCrawler/.test(userAgent) && !/GPTBot|ClaudeBot/.test(userAgent)), "readiness probes impersonated a third-party agent");
  assert.equal(validJsonProbe(findProbe(fetchedReadiness, "mcp_server_card")), true);
  assert.equal(validJsonProbe({
    id: "mcp_server_card",
    url: "https://93.184.216.34/.well-known/mcp/server-card.json",
    status: 200,
    ok: true,
    contentType: "text/html",
    body: '{"version":"1"}',
    observedAt
  }), false, "JSON served with a misleading content type must not pass");
  assert.equal(validJsonProbe({
    id: "mcp_server_card",
    url: "https://93.184.216.34/.well-known/mcp/server-card.json",
    status: 200,
    ok: true,
    contentType: "application/json",
    body: "[]",
    observedAt
  }), false, "a JSON array must not satisfy a discovery-document object schema");

  const readinessOnlyRequests: Array<{ url: string; accept: string }> = [];
  const reusedReadiness = await collectAgentReadinessProbes({
    url: "https://93.184.216.34/",
    existingEvidence: {
      robots: {
        url: "https://93.184.216.34/robots.txt",
        found: true,
        body: "User-agent: *\nAllow: /\nContent-Signal: search=yes, ai-input=yes, ai-train=no\n"
      },
      homepage: {
        url: "https://93.184.216.34/",
        finalUrl: "https://93.184.216.34/",
        status: 200,
        contentType: "text/html",
        linkHeader: '<https://93.184.216.34/index.md>; rel="alternate"; type="text/markdown"',
        body: "<main>Northstar Collision Repair</main>"
      }
    },
    fetchImpl: (async (request, init) => {
      readinessOnlyRequests.push({
        url: String(request),
        accept: new Headers(init?.headers).get("accept") ?? ""
      });
      return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
    }) as typeof fetch
  });
  assert.equal(reusedReadiness.probes.length, 12);
  assert.equal(readinessOnlyRequests.length, 10, "the readiness phase duplicated retained robots or HTML homepage requests");
  assert.equal(readinessOnlyRequests.some((request) => new URL(request.url).pathname === "/robots.txt"), false);
  assert.equal(readinessOnlyRequests.filter((request) => new URL(request.url).pathname === "/").length, 1, "only the Markdown-negotiated homepage should be requested");
  assert.match(readinessOnlyRequests.find((request) => new URL(request.url).pathname === "/")?.accept ?? "", /text\/markdown/);

  const readinessChecks = agentReadinessForPublicUrl({
    crawl: crawlFixture(),
    ingestion: ingestionFixture(),
    probes: fetchedReadiness,
    generatedAt: observedAt,
    vertical: "auto_body",
    verticalConfidence: 0.95
  }).checks;
  const readinessStatus = new Map(readinessChecks.map((check) => [check.id, check.status]));
  assert.deepEqual(
    readinessChecks.map((check) => check.id).sort(),
    agentReadinessCheckDefinitions.map((check) => check.id).sort(),
    "the public URL adapter omitted an Agent Readiness check"
  );
  for (const id of [
    "agent.answer.entity_consistency",
    "agent.answer.direct_answers",
    "agent.answer.citation_targets",
    "agent.content.markdown_negotiation",
    "agent.content.markdown_parity",
    "agent.content.llms_txt",
    "agent.discoverability.link_headers",
    "agent.bot.ai_rules",
    "agent.bot.content_signals",
    "agent.protocol.api_catalog"
  ]) assert.equal(readinessStatus.get(id), "pass", `${id} did not pass its positive fixture`);

  const conflictingIdentity = structuredClone(fetchedReadiness);
  const conflictingIdentityHtml = findProbe(conflictingIdentity, "html_home");
  if (conflictingIdentityHtml) {
    conflictingIdentityHtml.body = '<main><h1>Northstar Collision Repair</h1></main><script type="application/ld+json">{"@type":"LocalBusiness","name":"Different Repair Company"}</script>';
  }
  assert.equal(agentReadinessForPublicUrl({
    crawl: crawlFixture(),
    ingestion: ingestionFixture(),
    probes: conflictingIdentity,
    generatedAt: observedAt,
    vertical: "auto_body",
    verticalConfidence: 0.95
  }).checks.find((check) => check.id === "agent.answer.entity_consistency")?.status, "fail");

  const invalidIdentity = structuredClone(fetchedReadiness);
  const invalidIdentityHtml = findProbe(invalidIdentity, "html_home");
  if (invalidIdentityHtml) {
    invalidIdentityHtml.body = '<main><h1>Northstar Collision Repair</h1></main><script type="application/ld+json">{"@type":"LocalBusiness",</script>';
  }
  assert.equal(agentReadinessForPublicUrl({
    crawl: crawlFixture(),
    ingestion: ingestionFixture(),
    probes: invalidIdentity,
    generatedAt: observedAt,
    vertical: "auto_body",
    verticalConfidence: 0.95
  }).checks.find((check) => check.id === "agent.answer.entity_consistency")?.status, "fail");

  const misleadingMarkdown = structuredClone(fetchedReadiness);
  const markdownProbe = findProbe(misleadingMarkdown, "markdown_home");
  if (markdownProbe) markdownProbe.body = "# Generic page\n\nNothing about the business.";
  assert.equal(agentReadinessForPublicUrl({
    crawl: crawlFixture(),
    ingestion: ingestionFixture(),
    probes: misleadingMarkdown,
    generatedAt: observedAt,
    vertical: "auto_body",
    verticalConfidence: 0.95
  }).checks.find((check) => check.id === "agent.content.markdown_parity")?.status, "fail");

  const emptyMarkdown = structuredClone(fetchedReadiness);
  const emptyMarkdownProbe = findProbe(emptyMarkdown, "markdown_home");
  if (emptyMarkdownProbe) emptyMarkdownProbe.body = "";
  const emptyMarkdownChecks = agentReadinessForPublicUrl({
    crawl: crawlFixture(),
    ingestion: ingestionFixture(),
    probes: emptyMarkdown,
    generatedAt: observedAt,
    vertical: "auto_body",
    verticalConfidence: 0.95
  }).checks;
  assert.equal(emptyMarkdownChecks.find((check) => check.id === "agent.content.markdown_negotiation")?.status, "warning");
  assert.equal(emptyMarkdownChecks.find((check) => check.id === "agent.content.markdown_parity")?.status, "unknown");

  const blockedAnswerAgent = structuredClone(fetchedReadiness);
  blockedAnswerAgent.robots.aiAgents.push("OAI-SearchBot");
  blockedAnswerAgent.robots.blockedAiAgents.push("OAI-SearchBot");
  assert.equal(agentReadinessForPublicUrl({
    crawl: crawlFixture(),
    ingestion: ingestionFixture(),
    probes: blockedAnswerAgent,
    generatedAt: observedAt,
    vertical: "auto_body",
    verticalConfidence: 0.95
  }).checks.find((check) => check.id === "agent.bot.ai_rules")?.status, "fail", "explicit answer-agent blocking must be a major opportunity");

  const interactionOnlyHtml = structuredClone(fetchedReadiness);
  const htmlProbe = findProbe(interactionOnlyHtml, "html_home");
  if (htmlProbe) htmlProbe.body = '<main id="app"></main><canvas aria-label="Business details"></canvas><script>renderBusinessFacts()</script>';
  assert.equal(agentReadinessForPublicUrl({
    crawl: crawlFixture(),
    ingestion: ingestionFixture(),
    probes: interactionOnlyHtml,
    generatedAt: observedAt,
    vertical: "auto_body",
    verticalConfidence: 0.95
  }).checks.find((check) => check.id === "agent.answer.extractable_content")?.status, "fail", "JS-only or canvas-only primary facts must not pass semantic-content extraction");

  const leadGenerationProbes = withoutCapabilities(fetchedReadiness);
  const leadGenerationChecks = agentReadinessForPublicUrl({
    crawl: crawlFixture({ linkHref: "https://booking.example/reserve", linkKind: "booking" }),
    ingestion: ingestionFixture(),
    probes: leadGenerationProbes,
    generatedAt: observedAt,
    vertical: "general_local",
    verticalConfidence: 0.35
  }).checks;
  assert.equal(leadGenerationChecks.find((check) => check.id === "agent.answer.direct_answers")?.status, "not_applicable");
  assert.equal(leadGenerationChecks.find((check) => check.id === "agent.protocol.api_catalog")?.status, "not_applicable");
  assert.equal(leadGenerationChecks.find((check) => check.id === "agent.commerce.ucp")?.status, "not_applicable", "third-party booking must not trigger on-domain commerce applicability");

  const onDomainCommerceChecks = agentReadinessForPublicUrl({
    crawl: crawlFixture({ linkHref: "https://93.184.216.34/checkout", linkKind: "ordering" }),
    ingestion: ingestionFixture(),
    probes: leadGenerationProbes,
    generatedAt: observedAt,
    vertical: "general_local",
    verticalConfidence: 0.35
  }).checks;
  assert.equal(onDomainCommerceChecks.find((check) => check.id === "agent.commerce.ucp")?.status, "warning");

  const apiProbes = structuredClone(leadGenerationProbes);
  apiProbes.capabilities.api = true;
  const apiChecks = agentReadinessForPublicUrl({
    crawl: crawlFixture(),
    ingestion: ingestionFixture(),
    probes: apiProbes,
    generatedAt: observedAt,
    vertical: "general_local",
    verticalConfidence: 0.35
  }).checks;
  assert.equal(apiChecks.find((check) => check.id === "agent.protocol.api_catalog")?.status, "warning");

  const blockedProbes = await collectAgentReadinessProbes({
    url: "https://93.184.216.34/",
    fetchImpl: (async (request) => new URL(String(request)).pathname === "/robots.txt"
      ? new Response("User-agent: LodestaGenerationCrawler\nDisallow: /\n", { status: 200, headers: { "content-type": "text/plain" } })
      : new Response("unexpected", { status: 500 })) as typeof fetch
  });
  assert.equal(blockedProbes.probes.filter((probe) => probe.skipped === "robots_disallowed").length, 11);
  assert.match(blockedProbes.limitations.join(" "), /robots\.txt disallowed/i);

  const timeoutProbes = await collectAgentReadinessProbes({
    url: "https://93.184.216.34/",
    fetchImpl: (async (request) => {
      const url = new URL(String(request));
      if (url.pathname === "/llms.txt") throw new DOMException("fixture timeout", "TimeoutError");
      return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
    }) as typeof fetch
  });
  assert.match(findProbe(timeoutProbes, "llms_txt")?.error ?? "", /timeout/i);

  const unsafeRedirectProbes = await collectAgentReadinessProbes({
    url: "https://93.184.216.34/",
    fetchImpl: (async (request) => new URL(String(request)).pathname === "/robots.txt"
      ? new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } })
      : new Response("Not found", { status: 404 })) as typeof fetch
  });
  assert.match(findProbe(unsafeRedirectProbes, "robots_txt")?.error ?? "", /private|reserved/i);
  await assert.rejects(
    () => collectAgentReadinessProbes({ url: "http://127.0.0.1/private", fetchImpl: (async () => new Response("unexpected")) as typeof fetch }),
    /private|reserved/i
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
  const artifactAssessment = await assessSiteArtifact({ artifact, buildInput, assessmentId: "website_assessment_artifact" });
  const criterionStatus = (assessment: typeof artifactAssessment, id: string) =>
    assessment.dimensions.flatMap((dimension) => dimension.criteria).find((criterion) => criterion.id === id)?.status;
  assert.equal(artifactAssessment.target.artifactId, artifact.id);
  assert.match(artifactAssessment.coverage.limitations.join(" "), /ingestion and verification evidence/);
  assert.equal(artifactAssessment.dimensions.flatMap((dimension) => dimension.criteria).find((criterion) => criterion.id === "functional.form_path")?.status, "pass");
  assert.equal(
    artifactAssessment.agentReadiness.groups.flatMap((group) => group.checks).find((check) => check.id === "agent.content.markdown_negotiation")?.status,
    "unknown",
    "artifact assessments must not claim public serving behavior"
  );
  assert.equal(
    artifactAssessment.agentReadiness.groups.flatMap((group) => group.checks).find((check) => check.id === "agent.protocol.mcp_server_card")?.status,
    "not_applicable"
  );
  assert.deepEqual(
    artifactAssessment.agentReadiness.groups.flatMap((group) => group.checks).map((check) => check.id).sort(),
    agentReadinessCheckDefinitions.map((check) => check.id).sort(),
    "the site artifact adapter omitted an Agent Readiness check"
  );
  assert.deepEqual(
    artifactAssessment.visualQuality.groups.flatMap((group) => group.checks).map((check) => check.id).sort(),
    visualQualityCheckDefinitions.map((check) => check.id).sort(),
    "the site artifact adapter omitted a Visual Quality check"
  );
  assert.equal(artifactAssessment.visualQuality.evaluator.status, "unavailable");
  assert.equal(criterionStatus(artifactAssessment, "performance.readable_text"), "unknown", "A legacy artifact without current browser evidence received readability credit.");

  const currentArtifactAssessment = await assessSiteArtifact({
    artifact: siteBuildArtifactSchema.parse({ ...artifact, toolchainVersion: siteToolchainIdentity }),
    buildInput,
    assessmentId: "website_assessment_artifact_current"
  });
  assert.equal(criterionStatus(currentArtifactAssessment, "performance.readable_text"), "pass", "Current retained browser evidence did not receive readable-text credit.");

  const readabilityWarningAssessment = await assessSiteArtifact({
    artifact: siteBuildArtifactSchema.parse({
      ...artifact,
      toolchainVersion: siteToolchainIdentity,
      qa: {
        ...artifact.qa,
        findings: [
          ...artifact.qa.findings,
          { id: "render.body_font", severity: "warning", area: "render", message: "Body copy computes below 16px.", route: "/" }
        ]
      }
    }),
    buildInput,
    assessmentId: "website_assessment_artifact_readability"
  });
  assert.equal(criterionStatus(readabilityWarningAssessment, "performance.readable_text"), "warning", "Retained sub-16px body copy was dropped from scoring.");

  const functionalFailureAssessment = await assessSiteArtifact({
    artifact: siteBuildArtifactSchema.parse({
      ...artifact,
      toolchainVersion: siteToolchainIdentity,
      qa: {
        ...artifact.qa,
        hardGate: "failed",
        findings: [
          ...artifact.qa.findings,
          { id: "render.managed_content_clipped", severity: "error", area: "capability", message: "Managed location content is clipped.", route: "/" }
        ]
      }
    }),
    buildInput,
    assessmentId: "website_assessment_artifact_functional"
  });
  assert.equal(criterionStatus(functionalFailureAssessment, "functional.browser_errors"), "fail", "Clipped managed content did not reduce functional integrity.");

  const orphanAssessment = await assessSiteArtifact({
    artifact: siteBuildArtifactSchema.parse({
      ...artifact,
      toolchainVersion: siteToolchainIdentity,
      qa: {
        ...artifact.qa,
        findings: [
          ...artifact.qa.findings,
          { id: "route.orphan", severity: "warning", area: "route", message: "Route has no inbound internal link.", route: "/campaign" }
        ]
      }
    }),
    buildInput,
    assessmentId: "website_assessment_artifact_orphan"
  });
  assert.equal(criterionStatus(orphanAssessment, "functional.internal_destinations"), "warning", "An orphan-route IA advisory was treated as a broken functional destination.");
  const artifactWithContactSheet = siteBuildArtifactSchema.parse({
    ...artifact,
    qa: {
      ...artifact.qa,
      screenshotKeys: [
        `${artifact.storagePrefix}/contact-sheet.png`,
        `${artifact.storagePrefix}/home-desktop.png`,
        `${artifact.storagePrefix}/home-mobile.png`
      ]
    }
  });
  const artifactContactSheet = Buffer.from("retained artifact visual contact sheet");
  const artifactVisualQuality = await evaluateArtifactVisualQuality({
    artifact: artifactWithContactSheet,
    buildInput,
    observedAt,
    client: visualEvaluatorClient(),
    store: {
      async putImmutable() {
        throw new Error("Artifact contact-sheet reuse must be read-only.");
      },
      async get(key) {
        return key.endsWith("/contact-sheet.png")
          ? {
              key,
              bytes: artifactContactSheet,
              contentType: "image/png",
              contentHash: sha256(artifactContactSheet)
            }
          : undefined;
      },
      async exists(key) {
        return key.endsWith("/contact-sheet.png");
      }
    }
  });
  assert.equal(artifactVisualQuality.evaluator.status, "completed");
  assert.equal(artifactVisualQuality.evaluator.screenshotSetHash, sha256(artifactContactSheet));
  assert.match(artifactVisualQuality.coverage.limitations.join(" "), /retained artifact verification screenshots/i);

  const calibration = summarizeAssessmentCalibration({
    schemaVersion: 1,
    kind: "website-assessment-calibration",
    rubricIdentity: strong.producer.rubricIdentity,
    visualMethodologyIdentity: strong.visualQuality.methodologyIdentity,
    visualEvaluatorIdentity: strong.visualQuality.evaluator.identity,
    reviews: [{
      assessmentId: strong.id,
      vertical: "auto_body",
      reviewer: "reviewer_fixture",
      reviewedAt: observedAt,
      criteria: [{ criterionId: "trust.proof", certainty: "inferred", automatedStatus: "warning", expectedStatus: "warning" }],
      visualRun: { status: "completed", durationMs: 1_000, estimatedCostUsd: 0.02 },
      visualChecks: [
        { checkId: "visual.hierarchy.primary_action", automatedStatus: "warning", expectedStatus: "warning" },
        {
          checkId: "visual.brand.coherence",
          automatedStatus: "warning",
          expectedStatus: "pass",
          note: "Brand-coherence calibration remains internal and must not demote public concrete checks."
        }
      ]
    }]
  });
  assert.equal(calibration.inferredPrecision, 1);
  assert.equal(calibration.readiness.minimumReviewedSitesMet, false);
  assert.equal(calibration.readiness.launchVerticalCoverageMet, false);
  assert.equal(calibration.readiness.everyDisagreementDocumented, true);
  assert.equal(calibration.readiness.publicScoreApproved, false);
  assert.equal(calibration.visualQuality.checks[0]?.precision, 1);
  assert.equal(calibration.visualQuality.unavailableRate, 0);
  assert.equal(calibration.visualQuality.totalEstimatedCostUsd, 0.02);
  assert.equal(calibration.visualQuality.readiness.overlappingReviewerSitesMet, false);
  assert.equal(calibration.visualQuality.readiness.publicEligiblePrecisionMet, true);

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
  assert.equal(websiteAssessmentRecordIsCurrent(retryRecord), true);
  assert.equal(websiteAssessmentRecordIsCurrent({
    ...retryRecord,
    assessment: {
      ...strong,
      agentReadiness: {
        ...strong.agentReadiness,
        methodologyIdentity: `agent-readiness@sha256:${"0".repeat(64)}`
      }
    }
  }), false, "stale Agent Readiness methodologies must not be reused");
  assert.equal(websiteAssessmentRecordIsCurrent({
    ...retryRecord,
    assessment: {
      ...strong,
      visualQuality: {
        ...strong.visualQuality,
        methodologyIdentity: `visual-quality@sha256:${"0".repeat(64)}`
      }
    }
  }), false, "stale Visual Quality methodologies must not be reused");
  assert.equal(websiteAssessmentRecordIsCurrent({
    ...retryRecord,
    assessment: {
      ...strong,
      visualQuality: {
        ...strong.visualQuality,
        evaluator: {
          ...strong.visualQuality.evaluator,
          identity: `visual-evaluator@sha256:${"0".repeat(64)}`
        }
      }
    }
  }), false, "stale Visual Quality evaluators must not be reused");
  assert.equal(websiteAssessmentRecordIsCurrent({
    ...retryRecord,
    scannerIdentity: `website-assessment-scanner@sha256:${"0".repeat(64)}`
  }), false, "stale scanner identities must not be reused");
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

  const publishedSite = platformSiteRecordSchema.parse({
    id: "site_published_assessment_fixture",
    ownerUserId: "00000000-0000-4000-8000-000000000001",
    businessId: "business_published_assessment_fixture",
    slug: "northstar-collision",
    status: "active",
    reportingTimezone: "America/Chicago",
    publishedVersionId: "site_version_published_assessment_fixture",
    createdAt: observedAt,
    updatedAt: observedAt
  });
  const publishedVersion = siteVersionSchema.parse({
    schemaVersion: 1,
    id: "site_version_published_assessment_fixture",
    siteId: publishedSite.id,
    number: 1,
    status: "published",
    artifactId: "artifact_published_assessment_fixture",
    artifactHash: sha256("published-artifact"),
    workspaceRevisionId: "workspace_revision_published_assessment_fixture",
    publicBuildInputId: "public_build_input_published_assessment_fixture",
    formDefinitionIds: [],
    sourceSnapshotIds: [],
    assetRevisionIds: [],
    createdAt: observedAt,
    createdBy: { kind: "owner", id: "owner_published_assessment_fixture" },
    publishedAt: observedAt
  });
  let publishedAssessmentCreate: Parameters<PlatformOperationsRepository["createWebsiteAssessment"]>[0] | undefined;
  let publishedAssessmentJobs = 0;
  const publishedAssessmentResult = await enqueuePublishedSiteAssessment({
    site: publishedSite,
    version: publishedVersion,
    repository: {
      async listDomains() {
        return [{
          id: "domain_published_assessment_fixture",
          siteId: publishedSite.id,
          hostname: "northstar.example",
          status: "active",
          ownershipProofStatus: "verified",
          routingStatus: "active",
          providerStatus: "active",
          certificateStatus: "active",
          verificationName: "_lodesta.northstar.example",
          verificationValue: "fixture",
          routingName: "northstar.example",
          routingTarget: "domains.lodesta.example",
          expiresAt: "2027-07-23T12:00:00.000Z",
          createdAt: observedAt,
          updatedAt: observedAt,
          providerInvalidCount: 0,
          executionFailureCount: 0
        }];
      },
      async listWebsiteAssessments() {
        return [];
      },
      async createWebsiteAssessment(input) {
        publishedAssessmentCreate = input;
        return {
          id: "website_assessment_published_fixture",
          status: "queued",
          targetKind: input.targetKind,
          sourceKey: input.sourceKey,
          sourceUrl: input.sourceUrl,
          siteId: input.siteId,
          artifactId: input.artifactId,
          versionId: input.versionId,
          rubricIdentity: input.rubricIdentity,
          scannerIdentity: input.scannerIdentity,
          createdAt: observedAt,
          updatedAt: observedAt
        };
      },
      async enqueueWebsiteAssessmentJob({ assessmentId }) {
        publishedAssessmentJobs += 1;
        return {
          id: "website_assessment_job_published_fixture",
          assessmentId,
          status: "queued",
          attempts: 0,
          maxAttempts: 2,
          runAfter: observedAt,
          createdAt: observedAt,
          updatedAt: observedAt
        };
      }
    }
  });
  assert.equal(publishedAssessmentResult?.assessment.targetKind, "published_site");
  assert.equal(publishedAssessmentCreate?.sourceUrl, "https://northstar.example/");
  assert.equal(publishedAssessmentCreate?.sourceKey, `published:${publishedVersion.id}`);
  assert.equal(publishedAssessmentJobs, 1);

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
  assert.deepEqual(
    strong.agentReadiness.groups.flatMap((group) => group.checks).map((check) => check.id).sort(),
    agentReadinessCheckDefinitions.map((check) => check.id).sort(),
    "the canonical assessment omitted an Agent Readiness check"
  );
  assert.deepEqual(
    strong.visualQuality.groups.flatMap((group) => group.checks).map((check) => check.id).sort(),
    visualQualityCheckDefinitions.map((check) => check.id).sort(),
    "the canonical assessment omitted a Visual Quality check"
  );
  assert.equal(strong.visualQuality.methodologyIdentity, visualQualityMethodologyIdentity);

  const crawlerPage = readFileSync("app/(marketing)/crawler/page.tsx", "utf8");
  assert.match(crawlerPage, /robots\.txt/);
  assert.match(crawlerPage, /does not.*submit third-party forms/is);
  assert.match(readFileSync(".env.example", "utf8"), /GOOGLE_CRUX_API_KEY=/);
  assert.match(readFileSync(".env.example", "utf8"), /LODESTA_VISUAL_ASSESSMENT_MODEL=/);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    checks: [
      "rubric_weights",
      "agent_readiness_contract_and_composite_isolation",
      "visual_quality_contract_and_composite_isolation",
      "visual_quality_evaluator_validation_and_applicability",
      "coverage_gate",
      "critical_override",
      "findings_only_projection",
      "inferred_confidence_gate",
      "agent_readiness_confidence_gate",
      "visual_quality_public_confidence_gate",
      "agent_readiness_probe_and_applicability_fixtures",
      "artifact_adapter",
      "calibration_guard",
      "immutable_retry_recovery",
      "identity_reuse_and_published_site_enqueue",
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
