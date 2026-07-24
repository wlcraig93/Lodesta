import { createHash } from "node:crypto";
import {
  agentReadinessSchema,
  type AgentReadiness,
  type AgentReadinessAlignment,
  type AgentReadinessCheckInput,
  type AgentReadinessGroupId,
  type AssessmentApplicability,
  type AssessmentCertainty,
  type AssessmentEvidence,
  type AssessmentImpact,
  type AssessmentCriterionStatus
} from "./contracts";

const cloudflareMethodologyUrl = "https://blog.cloudflare.com/agent-readiness/";
const lodestaMethodologyUrl = "https://lodesta.com/crawler/";

export type AgentReadinessCheckDefinition = {
  id: string;
  groupId: AgentReadinessGroupId;
  title: string;
  impact: AssessmentImpact;
  applicability: AssessmentApplicability;
  businessConsequence: string;
  recommendation: string;
  standard: {
    authority: "cloudflare" | "lodesta";
    referenceUrl: string;
    countedByAuthority: boolean;
  };
};

export const agentReadinessGroupLabels: Readonly<Record<AgentReadinessGroupId, string>> = {
  answer_quality: "Answer quality",
  basic_web_presence: "Basic web presence",
  discoverability: "Discoverability",
  content_accessibility: "Content accessibility",
  bot_access_control: "Bot access control",
  protocol_discovery: "Protocol discovery",
  commerce: "Commerce"
};

function definition(
  id: string,
  groupId: AgentReadinessGroupId,
  title: string,
  impact: AssessmentImpact,
  applicability: AssessmentApplicability,
  businessConsequence: string,
  recommendation: string,
  authority: "cloudflare" | "lodesta" = "cloudflare",
  countedByAuthority = true
): AgentReadinessCheckDefinition {
  return {
    id,
    groupId,
    title,
    impact,
    applicability,
    businessConsequence,
    recommendation,
    standard: {
      authority,
      referenceUrl: authority === "cloudflare" ? cloudflareMethodologyUrl : lodestaMethodologyUrl,
      countedByAuthority
    }
  };
}

export const agentReadinessCheckDefinitions: ReadonlyArray<AgentReadinessCheckDefinition> = [
  definition("agent.answer.entity_consistency", "answer_quality", "Visible identity agrees with machine-readable business facts", "major", "business_specific", "Conflicting business facts make an answer engine less likely to trust or cite the website.", "Publish one verified name, phone, location, and URL consistently in visible content and LocalBusiness JSON-LD.", "lodesta", false),
  definition("agent.answer.service_location_coverage", "answer_quality", "Services and locations are specific and internally consistent", "major", "business_specific", "An answer engine cannot confidently match the business to a local need when service and location facts are thin or contradictory.", "Describe the confirmed services and markets served with specific, consistent first-party facts.", "lodesta", false),
  definition("agent.answer.direct_answers", "answer_quality", "Important customer questions receive direct answers", "minor", "vertical", "Indirect or incomplete content is harder to extract into a reliable answer.", "Answer the category-specific questions customers use to qualify the business in concise, self-contained sections.", "lodesta", false),
  definition("agent.answer.extractable_content", "answer_quality", "Primary facts are available in crawlable semantic content", "major", "universal", "Facts that exist only in imagery, canvas, or interaction-only UI may be invisible to answer engines.", "Render the primary business, service, location, and contact facts as semantic server-readable text.", "lodesta", false),
  definition("agent.answer.citation_targets", "answer_quality", "Important services and locations have stable citation targets", "minor", "business_specific", "Answer engines need stable, descriptive URLs they can retrieve and cite for a specific customer question.", "Publish canonical service and location pages with descriptive titles and substantive first-party content.", "lodesta", false),

  definition("agent.basic.home_reachable", "basic_web_presence", "The canonical homepage is reachable", "major", "universal", "Agents cannot discover or use a website whose canonical entry point is unavailable.", "Restore a successful response for the canonical homepage."),
  definition("agent.basic.https", "basic_web_presence", "The canonical website uses HTTPS", "major", "universal", "Insecure transport weakens trust and may be rejected by automated clients.", "Serve and redirect all public resources through HTTPS."),

  definition("agent.discoverability.robots", "discoverability", "robots.txt declares crawl access", "major", "universal", "Missing or accidental crawl rules make agent access ambiguous or block important content.", "Publish a valid robots.txt with intentional access rules and a sitemap reference."),
  definition("agent.discoverability.sitemap", "discoverability", "An XML sitemap is discoverable", "minor", "universal", "Agents must crawl more pages and may miss important services when no sitemap is available.", "Publish a current XML sitemap containing canonical public routes."),
  definition("agent.discoverability.link_headers", "discoverability", "HTTP Link headers expose useful machine-readable resources", "minor", "universal", "Agents may miss alternate representations and protocol resources hidden only in page markup.", "Advertise canonical or alternate machine-readable resources with valid HTTP Link headers."),

  definition("agent.content.markdown_negotiation", "content_accessibility", "Pages support Markdown content negotiation", "minor", "universal", "HTML consumes more context and can obscure the primary answer for text-oriented agents.", "Return a useful text/markdown representation when the request accepts Markdown."),
  definition("agent.content.markdown_parity", "content_accessibility", "Markdown preserves the important visible facts", "major", "universal", "A nominal Markdown response is harmful when it omits the facts available to human visitors.", "Keep business identity, services, locations, contact paths, and canonical links in the Markdown representation.", "lodesta", false),
  definition("agent.content.llms_txt", "content_accessibility", "llms.txt provides a useful reading map", "advisory", "universal", "A concise machine-readable directory can reduce discovery cost for agents that support the emerging convention.", "Publish a concise /llms.txt that describes the business and links canonical Markdown resources.", "cloudflare", false),

  definition("agent.bot.ai_rules", "bot_access_control", "robots.txt contains intentional AI crawler rules", "major", "universal", "Generic or conflicting bot rules can unintentionally block answer and user-triggered agents.", "Declare intentional AI search, input, and training access for known crawler categories."),
  definition("agent.bot.content_signals", "bot_access_control", "robots.txt declares Content Signals", "minor", "universal", "Without explicit content-use preferences, automated systems cannot distinguish search, inference, and training intent.", "Declare search, ai-input, and ai-train preferences with Content-Signal directives."),
  definition("agent.bot.web_bot_auth", "bot_access_control", "Web Bot Auth discovery is available", "advisory", "capability", "An agent operated by the site cannot authenticate its outbound requests through the emerging standard when discovery is absent.", "Publish valid HTTP message-signature key discovery when the site operates an outbound agent."),

  definition("agent.protocol.agent_skills", "protocol_discovery", "Agent Skills are discoverable", "advisory", "capability", "Agents cannot reliably discover task-specific instructions for an advertised capability.", "Publish a valid Agent Skills index for agent-invocable business capabilities."),
  definition("agent.protocol.api_catalog", "protocol_discovery", "Public APIs have a discoverable API Catalog", "advisory", "capability", "Agents must scrape documentation or guess endpoints when public APIs are not cataloged.", "Publish a valid RFC 9727 API Catalog for public APIs."),
  definition("agent.protocol.oauth_authorization_server", "protocol_discovery", "OAuth authorization-server metadata is discoverable", "advisory", "capability", "Agents cannot safely initiate delegated authorization when the authorization server is undiscoverable.", "Publish valid RFC 8414 authorization-server metadata when OAuth is offered."),
  definition("agent.protocol.oauth_protected_resource", "protocol_discovery", "OAuth protected-resource metadata is discoverable", "advisory", "capability", "Agents cannot determine how to obtain access to a protected resource safely.", "Publish valid RFC 9728 protected-resource metadata for protected agent-accessible resources."),
  definition("agent.protocol.mcp_server_card", "protocol_discovery", "An advertised MCP server has a discoverable Server Card", "advisory", "capability", "Agents cannot safely understand or connect to an MCP service that lacks discovery metadata.", "Publish a valid MCP Server Card for any public MCP service."),
  definition("agent.protocol.webmcp", "protocol_discovery", "Advertised browser tools expose WebMCP", "advisory", "capability", "Browser agents must fall back to fragile visual interaction when declared tools are unavailable.", "Expose stable WebMCP tools only for intentional, owner-approved browser capabilities."),

  definition("agent.commerce.x402", "commerce", "Agentic payment resources advertise x402", "advisory", "capability", "Agents cannot discover machine-readable payment requirements for an agentic transaction.", "Advertise and validate x402 only for resources intentionally sold to agents.", "cloudflare", false),
  definition("agent.commerce.ucp", "commerce", "On-domain commerce advertises Universal Commerce Protocol", "advisory", "capability", "Agents cannot use the emerging standardized product and checkout flow.", "Publish valid Universal Commerce Protocol discovery for an on-domain transactional storefront.", "cloudflare", false),
  definition("agent.commerce.acp", "commerce", "On-domain commerce advertises Agentic Commerce Protocol", "advisory", "capability", "Agents cannot use the emerging standardized merchant interaction flow.", "Publish valid Agentic Commerce Protocol discovery for an on-domain transactional storefront.", "cloudflare", false)
] as const;

export const agentReadinessMethodologyIdentity = `agent-readiness@sha256:${createHash("sha256")
  .update(JSON.stringify({ groups: agentReadinessGroupLabels, checks: agentReadinessCheckDefinitions }))
  .digest("hex")}`;

export function agentReadinessDefinition(id: string) {
  const value = agentReadinessCheckDefinitions.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`Unknown Agent Readiness check: ${id}`);
  return value;
}

export function agentReadinessCheck(input: {
  id: string;
  status: AssessmentCriterionStatus;
  alignment: AgentReadinessAlignment;
  explanation: string;
  evidence: AssessmentEvidence | AssessmentEvidence[];
  certainty?: AssessmentCertainty;
  confidence?: number;
}): AgentReadinessCheckInput {
  return {
    id: input.id,
    status: input.status,
    alignment: input.alignment,
    certainty: input.certainty ?? "deterministic",
    confidence: input.confidence,
    explanation: input.explanation,
    evidence: Array.isArray(input.evidence) ? input.evidence : [input.evidence]
  };
}

export function buildAgentReadiness(input: {
  checks: AgentReadinessCheckInput[];
  limitations?: string[];
  observedAt: string;
}): AgentReadiness {
  const supplied = new Map(input.checks.map((check) => [check.id, check]));
  const checks = agentReadinessCheckDefinitions.map((definition) => {
    const observed = supplied.get(definition.id);
    return {
      id: definition.id,
      groupId: definition.groupId,
      title: definition.title,
      status: observed?.status ?? "unknown",
      alignment: observed?.alignment ?? "not_tested",
      impact: definition.impact,
      certainty: observed?.certainty ?? "deterministic",
      confidence: observed?.confidence,
      applicability: definition.applicability,
      explanation: observed?.explanation ?? "The available evidence did not support a reliable conclusion.",
      businessConsequence: definition.businessConsequence,
      recommendation: definition.recommendation,
      evidence: observed?.evidence ?? [{
        id: `${definition.id}.coverage`,
        kind: "system" as const,
        summary: "No reliable evidence was captured for this Agent Readiness check.",
        observedAt: input.observedAt
      }],
      standard: definition.standard
    };
  });
  const groups = (Object.keys(agentReadinessGroupLabels) as AgentReadinessGroupId[]).map((id) => {
    const groupChecks = checks.filter((check) => check.groupId === id);
    const applicable = groupChecks.filter((check) => check.status !== "not_applicable");
    const assessed = applicable.filter((check) => check.status !== "unknown");
    return {
      id,
      label: agentReadinessGroupLabels[id],
      coverage: applicable.length ? round(assessed.length / applicable.length, 4) : 1,
      verifiedChecks: groupChecks.filter((check) => check.status === "pass").length,
      opportunityChecks: groupChecks.filter((check) => check.status === "warning" || check.status === "fail").length,
      unknownChecks: groupChecks.filter((check) => check.status === "unknown").length,
      notApplicableChecks: groupChecks.filter((check) => check.status === "not_applicable").length,
      applicableChecks: applicable.length,
      checks: groupChecks
    };
  });
  const applicable = checks.filter((check) => check.status !== "not_applicable");
  const assessed = applicable.filter((check) => check.status !== "unknown");
  return agentReadinessSchema.parse({
    methodologyIdentity: agentReadinessMethodologyIdentity,
    coverage: {
      value: applicable.length ? round(assessed.length / applicable.length, 4) : 1,
      assessedChecks: assessed.length,
      applicableChecks: applicable.length,
      limitations: [...new Set((input.limitations ?? []).filter(Boolean))]
    },
    counts: {
      verified: checks.filter((check) => check.status === "pass").length,
      opportunities: checks.filter((check) => check.status === "warning" || check.status === "fail").length,
      unknown: checks.filter((check) => check.status === "unknown").length,
      notApplicable: checks.filter((check) => check.status === "not_applicable").length
    },
    groups
  });
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
