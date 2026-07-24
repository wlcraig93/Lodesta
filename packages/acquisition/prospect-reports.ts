import { createHash } from "node:crypto";
import OpenAI from "openai";
import { normalizePublicFetchUrlInput } from "@/lib/url-safety";
import type {
  ProspectPresenceReportResult,
  ProspectReportFinding,
  ProspectReportGatedPlan,
  ProspectReportRecord,
  ProspectReportStage,
  ProspectWebsiteKind
} from "@/packages/platform-operations";
import { publicWebsiteAssessmentProjection } from "@/packages/website-assessment/public-projection";
import type { WebsiteAssessment } from "@/packages/website-assessment/contracts";
import { usageForModel } from "@/packages/site-agent/run-policy";
import { assessBusinessStrength } from "./business-strength";

type BudgetName = "prospect_scan";

const reusableReportWindowMs = 7 * 24 * 60 * 60 * 1000;
const socialOrAggregatorHosts = [
  "facebook.com",
  "fb.com",
  "instagram.com",
  "threads.net",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "yelp.com",
  "tripadvisor.com",
  "opentable.com",
  "doordash.com",
  "ubereats.com",
  "grubhub.com",
  "toasttab.com",
  "square.site",
  "linktr.ee",
  "linktree.com",
  "beacons.ai",
  "maps.google.com",
  "google.com",
  "g.page"
];

const budgetState = globalThis as typeof globalThis & {
  __lodestaProspectReportBudget?: Partial<Record<BudgetName, { day: string; used: number }>>;
  __lodestaProspectReportActiveScans?: number;
};

export function recentProspectReportCutoff(now = new Date()) {
  return new Date(now.getTime() - reusableReportWindowMs).toISOString();
}

export function classifyProspectWebsite(value: string | undefined): { kind: ProspectWebsiteKind; url?: string; host?: string } {
  const normalized = value?.trim() ? normalizePublicFetchUrlInput(value) : undefined;
  if (!normalized) return { kind: "no_website" };
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return { kind: "no_website" };
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (socialOrAggregatorHosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) {
    return { kind: "social_or_aggregator", url: parsed.href, host };
  }
  return { kind: "owned_website", url: parsed.href, host };
}

export function consumeProspectBudget(name: BudgetName) {
  const today = new Date().toISOString().slice(0, 10);
  budgetState.__lodestaProspectReportBudget ??= {};
  const current = budgetState.__lodestaProspectReportBudget[name];
  const state = current?.day === today ? current : { day: today, used: 0 };
  const cap = budgetCap(name);
  if (state.used >= cap) {
    console.warn(`Prospect report ${name} daily cap reached (${cap}).`);
    budgetState.__lodestaProspectReportBudget[name] = state;
    return false;
  }
  state.used += 1;
  budgetState.__lodestaProspectReportBudget[name] = state;
  return true;
}

export async function withProspectScanSlot<T>(fn: () => Promise<T>): Promise<T> {
  const active = budgetState.__lodestaProspectReportActiveScans ?? 0;
  if (active >= prospectScanConcurrencyLimit()) {
    throw new Error("Prospect report scan concurrency limit reached.");
  }
  budgetState.__lodestaProspectReportActiveScans = active + 1;
  try {
    return await fn();
  } finally {
    budgetState.__lodestaProspectReportActiveScans = Math.max(0, (budgetState.__lodestaProspectReportActiveScans ?? 1) - 1);
  }
}

export async function resolveProspectBusiness(input: { query: string }) {
  const direct = directWebsite(input.query);
  if (direct) {
    const website = classifyProspectWebsite(direct);
    return {
      sourceKey: sourceKeyForWebsite(direct),
      website,
      usMarket: true,
      displayName: website.host ?? direct,
      businessStrength: assessBusinessStrength({ source: "web_research" }),
      usage: undefined
    };
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Business resolution is not configured.");
  const modelId = "gpt-5.6-sol";
  const startedAt = Date.now();
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 90_000 });
  const response = await client.responses.create({
    model: modelId,
    store: false,
    tools: [{ type: "web_search", search_context_size: "medium" }],
    include: ["web_search_call.action.sources"],
    max_output_tokens: 1_200,
    instructions: "Resolve one US small business from the supplied business name and locality. Return its official owned website when confidently found. Do not return directory, social, Google Maps, or aggregator URLs.",
    input: input.query,
    text: {
      format: {
        type: "json_schema",
        name: "prospect_business_resolution",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            businessName: { type: "string" },
            locality: { type: "string" },
            websiteUrl: { type: ["string", "null"] },
            usMarket: { type: "boolean" },
            reviewRating: { type: ["number", "null"] },
            reviewCount: { type: ["integer", "null"] },
            yearsInBusiness: { type: ["number", "null"] }
          },
          required: ["businessName", "locality", "websiteUrl", "usMarket", "reviewRating", "reviewCount", "yearsInBusiness"]
        }
      }
    }
  });
  if (response.status !== "completed" || !response.output_text) throw new Error("Business resolution did not complete.");
  const parsed = JSON.parse(response.output_text) as { businessName: string; locality: string; websiteUrl: string | null; usMarket: boolean; reviewRating: number | null; reviewCount: number | null; yearsInBusiness: number | null };
  const website = classifyProspectWebsite(parsed.websiteUrl ?? undefined);
  const searchCalls = response.output.filter((item) => item.type === "web_search_call").length;
  const modelUsage = usageForModel(modelId, response.usage, Date.now() - startedAt);
  return {
    sourceKey: website.url
      ? sourceKeyForWebsite(website.url)
      : sourceKeyForNameAndLocality(parsed.businessName || input.query, parsed.locality),
    website,
    usMarket: parsed.usMarket,
    displayName: parsed.businessName || input.query,
    businessStrength: assessBusinessStrength({
      source: "web_research",
      reviewRating: parsed.reviewRating ?? undefined,
      reviewCount: parsed.reviewCount ?? undefined,
      yearsInBusiness: parsed.yearsInBusiness ?? undefined
    }),
    usage: {
      modelId,
      inputTokens: modelUsage.inputTokens,
      cachedInputTokens: modelUsage.cachedInputTokens,
      outputTokens: modelUsage.outputTokens,
      estimatedCostUsd: modelUsage.costUsd + searchCalls * 0.01,
      searchCalls
    }
  };
}

export function sourceKeyForWebsite(value: string) {
  return `url:${hash(canonicalWebsiteIdentity(value))}`;
}

export function sourceKeyForNameAndLocality(name: string, locality?: string) {
  const normalized = `${name} ${locality ?? ""}`.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
  return `query:${hash(normalized)}`;
}

export function prospectReportFromAssessment(
  assessment: WebsiteAssessment,
  input: { websiteKind?: ProspectWebsiteKind; sourceHost?: string } = {}
): ProspectPresenceReportResult {
  const projection = publicWebsiteAssessmentProjection(assessment);
  const findings = projection.findings;
  return {
    schemaVersion: 1,
    kind: "prospect-presence-report",
    generatedAt: projection.generatedAt,
    websiteKind: input.websiteKind ?? "owned_website",
    sourceUrl: projection.sourceUrl,
    sourceHost: input.sourceHost ?? hostFromUrl(projection.sourceUrl),
    assessmentId: projection.assessmentId,
    coverage: projection.coverage,
    siteUnderstanding: projection.siteUnderstanding,
    whatsWorking: projection.whatsWorking,
    findings,
    stages: [
      stage("business", "Business resolved", "completed"),
      stage("website", "Owned website detected", "completed"),
      stage("crawl", "Bounded website crawl completed", "completed"),
      stage("render", "Mobile browser evidence completed", assessment.coverage.limitations.some((item) => /browser.*unavailable/i.test(item)) ? "failed" : "completed"),
      stage("report", "Evidence report assembled", "completed")
    ],
    gatedPlan: gatedPlanForFindings(findings, "owned_website")
  };
}

export function noOwnedWebsiteProspectReport(input: {
  websiteKind: Exclude<ProspectWebsiteKind, "owned_website">;
  sourceUrl?: string;
  sourceHost?: string;
}): ProspectPresenceReportResult {
  const socialOnly = input.websiteKind === "social_or_aggregator";
  const finding: ProspectReportFinding = {
    id: "no_owned_website",
    dimension: "Owned website foundation",
    severity: "critical",
    status: "fail",
    title: socialOnly ? "The listing points to a profile, not an owned website" : "No owned website was found",
    explanation: socialOnly
      ? "The detected destination is controlled by a third-party profile platform."
      : "No crawlable owned website URL was available for assessment.",
    businessConsequence: socialOnly
      ? "Local customers leave the business listing for a third-party profile instead of an owned conversion path."
      : "Searchers have no owned place to evaluate services, trust proof, and contact options.",
    evidence: socialOnly && input.sourceHost
      ? [`Detected ${input.sourceHost} as the available website destination.`]
      : ["No crawlable owned website URL was available."],
    recommendation: "Create an owned, mobile-ready website with service, trust, contact, schema, and local content."
  };
  return {
    schemaVersion: 1,
    kind: "prospect-presence-report",
    generatedAt: new Date().toISOString(),
    websiteKind: input.websiteKind,
    sourceUrl: input.sourceUrl,
    sourceHost: input.sourceHost,
    siteUnderstanding: { services: [], customerJourneys: [] },
    whatsWorking: [],
    findings: [finding],
    stages: [
      stage("business", "Business resolved", "completed"),
      stage("website", socialOnly ? "Third-party profile detected" : "No owned website detected", "completed"),
      stage("crawl", "Website crawl skipped", "skipped"),
      stage("render", "Browser inspection skipped", "skipped"),
      stage("report", "Evidence report assembled", "completed")
    ],
    gatedPlan: gatedPlanForFindings([finding], input.websiteKind)
  };
}

export function publicProspectReport(report: ProspectReportRecord) {
  const unlocked = Boolean(report.unlockedAt);
  const result = report.result
    ? {
        ...report.result,
        gatedPlan: unlocked ? report.result.gatedPlan : undefined
      }
    : undefined;
  return {
    id: report.id,
    status: report.status,
    websiteKind: report.websiteKind,
    sourceUrl: report.sourceUrl,
    sourceHost: report.sourceHost,
    unlocked,
    result,
    error: report.status === "failed"
      ? "The scan could not finish. Try again later or contact Lodesta."
      : report.status === "completed" && !result
        ? "This report uses a stale schema and must be rebuilt."
        : undefined,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    completedAt: report.completedAt
  };
}

function gatedPlanForFindings(findings: ProspectReportFinding[], websiteKind: ProspectWebsiteKind): ProspectReportGatedPlan {
  if (websiteKind !== "owned_website") {
    return {
      summary: "Start with an owned website foundation before optimizing deeper local-presence signals.",
      priorities: [
        {
          title: "Create the owned website",
          detail: "Build a crawlable mobile site with services, location coverage, direct actions, and verified business facts."
        },
        {
          title: "Connect local trust",
          detail: "Add verified proof, contact paths, structured data, and a clear privacy path."
        }
      ]
    };
  }
  const priorities = findings.slice(0, 4).map((finding) => ({
    title: finding.title,
    detail: finding.recommendation
  }));
  return {
    summary: priorities.length
      ? "Turn the verified findings into a managed website improvement plan."
      : "Keep monitoring the website and improve the next useful local-presence opportunity.",
    priorities: priorities.length
      ? priorities
      : [{ title: "Keep the site maintained", detail: "Continue monitoring functionality, conversion, visibility, trust, and local content." }]
  };
}

function stage(id: string, label: string, status: ProspectReportStage["status"]): ProspectReportStage {
  return { id, label, status };
}

function budgetCap(_name: BudgetName) {
  const parsed = Number.parseInt(process.env.LODESTA_PROSPECT_REPORT_SCAN_DAILY_CAP ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}

function prospectScanConcurrencyLimit() {
  const parsed = Number.parseInt(process.env.LODESTA_PROSPECT_REPORT_SCAN_CONCURRENCY ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
}

function hostFromUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function directWebsite(value: string) {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.includes(".") && !/^https?:\/\//i.test(trimmed))) return undefined;
  try {
    return normalizePublicFetchUrlInput(trimmed);
  } catch {
    return undefined;
  }
}

function canonicalWebsiteIdentity(value: string) {
  const normalized = new URL(normalizePublicFetchUrlInput(value));
  normalized.protocol = "https:";
  normalized.hostname = normalized.hostname.toLowerCase().replace(/^www\./, "");
  normalized.port = "";
  normalized.username = "";
  normalized.password = "";
  normalized.search = "";
  normalized.hash = "";
  normalized.pathname = normalized.pathname.replace(/\/+$/, "") || "/";
  return normalized.href;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
