import { summarizeCrawlHtml, type CrawlAssessment } from "@/lib/crawler";
import type { WebsiteGenerationIngestion } from "@/packages/business-data/generation-crawler";
import type { SiteBuildArtifact, SitePublicBuildInput } from "@/packages/site-contracts";
import {
  agentReadinessCheck,
  agentReadinessCheckDefinitions
} from "./agent-readiness";
import {
  findProbe,
  validJsonProbe,
  type AgentReadinessProbeObservation,
  type AgentReadinessProbeResult
} from "./agent-readiness-probes";
import type {
  AgentReadinessAlignment,
  AgentReadinessCheckInput,
  AssessmentCriterionStatus,
  AssessmentEvidence
} from "./contracts";

const localBusinessTypePattern = /\b(?:LocalBusiness|AutomotiveBusiness|AutoBodyShop|AutoRepair|Dentist|Restaurant|FoodEstablishment|BeautySalon|HairSalon|NailSalon|DaySpa|HealthAndBeautyBusiness|MedicalBusiness|HomeAndConstructionBusiness|Plumber|Electrician|HVACBusiness|RoofingContractor|LegalService|AccountingService|ProfessionalService|RealEstateAgent|FinancialService|Store|SportsActivityLocation|ChildCare|VeterinaryCare|LodgingBusiness)\b/i;

export function agentReadinessForPublicUrl(input: {
  crawl: CrawlAssessment;
  ingestion: WebsiteGenerationIngestion;
  probes: AgentReadinessProbeResult;
  generatedAt: string;
  vertical: string;
  verticalConfidence: number;
}) {
  const { crawl, ingestion, probes, generatedAt } = input;
  const sourceUrl = crawl.finalUrl ?? crawl.url;
  const pages = crawl.pageSummaries;
  const primary = pages.find((page) => page.source === "primary") ?? pages[0];
  const visibleText = pages.map((page) => page.mainText ?? "").join("\n");
  const servicePages = pages.filter((page) => page.purposeTags.some((tag) => tag === "services" || tag === "service_detail"));
  const locationPages = pages.filter((page) => page.purposeTags.some((tag) => tag === "location" || tag === "contact"));
  const directAnswerPages = pages
    .map((page) => ({
      page,
      answerCount: page.purposeTags.includes("faq")
        ? Math.max(1, directQuestionCount(page.mainText ?? ""))
        : directQuestionCount(page.mainText ?? "")
    }))
    .filter((entry) => entry.answerCount > 0);
  const directAnswerCount = directAnswerPages.reduce((total, entry) => total + entry.answerCount, 0);
  const confidence = ingestion.coverage === "complete" ? 0.9 : ingestion.coverage === "bounded" ? 0.85 : 0.7;
  const html = findProbe(probes, "html_home");
  const markdown = findProbe(probes, "markdown_home");
  const llms = findProbe(probes, "llms_txt");
  const linkHeader = [html?.linkHeader, markdown?.linkHeader].filter(Boolean).join(", ");
  const usefulLinkHeader = hasUsefulLinkHeader(linkHeader, sourceUrl);
  const markdownResponse = Boolean(markdown?.ok && markdown.contentType?.toLowerCase().includes("text/markdown"));
  const markdownAvailable = markdownResponse && (markdown?.body?.trim().length ?? 0) >= 40;
  const markdownParity = keyFactParity(markdown?.body ?? "", crawl);
  const rawSemanticTextLength = html?.body
    ? summarizeCrawlHtml(html.body, html.finalUrl ?? html.url).mainText?.length ?? 0
    : undefined;
  const schema = localBusinessSchema(html?.body);
  const localBusinessMarkupAdvertised = [...(html?.body ?? "").matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .some((match) => localBusinessTypePattern.test(match[1]));
  const observedName = crawl.extractedFacts.name;
  const schemaNames = schema.map((node) => stringValue(node.name)).filter((value): value is string => Boolean(value));
  const schemaPhones = schema.map((node) => stringValue(node.telephone)).filter((value): value is string => Boolean(value));
  const visiblePhone = crawl.extractedFacts.phone;
  const schemaAddresses = schema.map((node) => addressValue(node.address)).filter((value): value is string => Boolean(value));
  const visibleAddress = formattedLocation(crawl);
  const schemaNameMatches = Boolean(observedName && schemaNames.some((name) => normalized(name) === normalized(observedName)));
  const schemaNameConflict = Boolean(observedName && schemaNames.length && !schemaNameMatches);
  const schemaPhoneConflict = Boolean(visiblePhone && schemaPhones.length && !schemaPhones.some((phone) => digits(phone) === digits(visiblePhone)));
  const schemaAddressConflict = Boolean(visibleAddress && schemaAddresses.length && !schemaAddresses.some((address) => locationMatches(address, visibleAddress)));
  const schemaInvalid = localBusinessMarkupAdvertised && (!schema.length || !schemaNames.length);
  const schemaConflicts = schemaInvalid || schemaNameConflict || schemaPhoneConflict || schemaAddressConflict;
  const hasLocation = Boolean(crawl.extractedFacts.address || crawl.extractedFacts.serviceAreas.length);
  const visibleNames = uniqueNormalized(pages.map((page) => page.extractedFacts?.name));
  const visiblePhones = uniqueNormalized(pages.map((page) => page.extractedFacts?.phone).map((phone) => phone ? digits(phone) : undefined));
  const visibleLocations = uniqueNormalized(pages.map((page) => page.extractedFacts?.address ? [
    page.extractedFacts.address.street,
    page.extractedFacts.address.city,
    page.extractedFacts.address.region,
    page.extractedFacts.address.postalCode
  ].filter(Boolean).join(", ") : undefined));
  const inconsistentVisibleFacts = visibleNames.some((left, index) =>
    visibleNames.slice(index + 1).some((right) => !left.includes(right) && !right.includes(left))
  );
  const onDomainCommerce = pages.flatMap((page) => page.linkReferences).some((link) => {
    try {
      return link.kind === "ordering" && sameSite(new URL(link.href).hostname, new URL(sourceUrl).hostname);
    } catch {
      return false;
    }
  }) || /\b(add to cart|shopping cart|checkout|buy now)\b/i.test(visibleText);
  const capabilities = probes.capabilities;
  const webAuth = findProbe(probes, "web_bot_auth");
  const skills = findProbe(probes, "agent_skills");
  const apiCatalog = findProbe(probes, "api_catalog");
  const oauthAuthorization = findProbe(probes, "oauth_authorization_server");
  const oauthProtected = findProbe(probes, "oauth_protected_resource");
  const mcp = findProbe(probes, "mcp_server_card");
  const ucp = findProbe(probes, "ucp");
  const acp = findProbe(probes, "acp");
  const agentCapability = capabilities.agent || capabilities.mcp || validJsonProbe(skills) || validJsonProbe(mcp);
  const apiCapability = capabilities.api || validJsonProbe(apiCatalog);
  const oauthCapability = capabilities.oauth || validJsonProbe(oauthAuthorization) || validJsonProbe(oauthProtected);
  const mcpCapability = capabilities.mcp || validJsonProbe(mcp);
  const commerceCapability = onDomainCommerce || capabilities.x402 || validJsonProbe(ucp) || validJsonProbe(acp);
  const blockedAnswerAgents = probes.robots.blockedAiAgents.filter((agent) => /(?:chatgpt-user|oai-search|claude-user|perplexity)/i.test(agent));

  const checks: AgentReadinessCheckInput[] = [
    check(
      "agent.answer.entity_consistency",
      !observedName
        ? "warning"
        : schemaConflicts
          ? "fail"
          : schemaNameMatches
            ? "pass"
            : "warning",
      schemaConflicts ? "present_invalid" : schemaNameMatches ? "present_valid" : "not_detected",
      !observedName
        ? "A clear visible business identity was not extracted."
        : schemaInvalid
          ? "LocalBusiness JSON-LD was advertised but could not be parsed as a valid named business identity."
          : schemaConflicts
          ? "Visible business identity facts conflict with the LocalBusiness JSON-LD."
          : schemaNameMatches
            ? `Visible business identity ${observedName} agrees with LocalBusiness JSON-LD.`
            : "No LocalBusiness JSON-LD with a matching business name was detected.",
      contentEvidence(
        "agent.answer.entity_consistency.content",
        `Visible name: ${observedName ?? "not detected"}; LocalBusiness names: ${schemaNames.join(", ") || "none"}; visible phone: ${visiblePhone ?? "not detected"}; LocalBusiness phones: ${schemaPhones.join(", ") || "none"}; visible address: ${visibleAddress ?? "not detected"}; LocalBusiness addresses: ${schemaAddresses.join(" | ") || "none"}.`,
        generatedAt,
        sourceUrl
      ),
      "inferred",
      observedName ? confidence : Math.min(confidence, 0.8)
    ),
    check(
      "agent.answer.service_location_coverage",
      inconsistentVisibleFacts ? "fail" : crawl.extractedFacts.services.length && hasLocation ? "pass" : crawl.extractedFacts.services.length || hasLocation ? "warning" : input.verticalConfidence >= 0.8 ? "fail" : "unknown",
      inconsistentVisibleFacts ? "present_invalid" : crawl.extractedFacts.services.length && hasLocation ? "present_valid" : crawl.extractedFacts.services.length || hasLocation ? "present_invalid" : "not_detected",
      inconsistentVisibleFacts
        ? "Business identity, phone, or location facts conflict across the sampled pages."
        : `Extracted ${crawl.extractedFacts.services.length} service fact(s) and ${hasLocation ? "a specific location or service area" : "no specific location or service area"}.`,
      contentEvidence("agent.answer.service_location_coverage.content", `Services: ${crawl.extractedFacts.services.slice(0, 10).join(", ") || "none"}; location: ${formattedLocation(crawl) ?? (crawl.extractedFacts.serviceAreas.join(", ") || "none")}; visible name variants: ${visibleNames.join(" | ") || "none"}; phone variants: ${visiblePhones.join(" | ") || "none"}; location variants: ${visibleLocations.join(" | ") || "none"}.`, generatedAt, sourceUrl),
      "inferred",
      confidence
    ),
    check(
      "agent.answer.direct_answers",
      input.verticalConfidence < 0.8 ? "not_applicable" : directAnswerCount >= 3 ? "pass" : directAnswerCount ? "warning" : "fail",
      input.verticalConfidence < 0.8 ? "not_tested" : directAnswerCount >= 3 ? "present_valid" : directAnswerCount ? "present_invalid" : "not_detected",
      input.verticalConfidence < 0.8
        ? `Direct-answer requirements were not applied because vertical confidence was ${Math.round(input.verticalConfidence * 100)}%.`
        : `${directAnswerCount} direct question-and-answer signal(s) appeared across ${directAnswerPages.length} page(s) for the inferred ${input.vertical.replaceAll("_", " ")} vertical.`,
      contentEvidence("agent.answer.direct_answers.content", `Qualifying answer pages: ${directAnswerPages.map((entry) => `${entry.page.url} (${entry.answerCount})`).join(", ") || "none"}.`, generatedAt, sourceUrl),
      "inferred",
      input.verticalConfidence < 0.8 ? undefined : Math.min(input.verticalConfidence, confidence)
    ),
    check(
      "agent.answer.extractable_content",
      rawSemanticTextLength === undefined ? "unknown" : rawSemanticTextLength >= 300 ? "pass" : rawSemanticTextLength >= 100 ? "warning" : "fail",
      rawSemanticTextLength === undefined ? "not_tested" : rawSemanticTextLength >= 300 ? "present_valid" : rawSemanticTextLength ? "present_invalid" : "not_detected",
      rawSemanticTextLength === undefined
        ? "The initial HTML response was unavailable for semantic-content verification."
        : `The initial HTML response exposed ${rawSemanticTextLength} characters of cleaned semantic text before browser rendering.`,
      contentEvidence("agent.answer.extractable_content.content", `Initial-response semantic text length: ${rawSemanticTextLength ?? "unavailable"} characters; rendered crawl text length: ${primary?.mainText?.length ?? 0} characters.`, generatedAt, sourceUrl)
    ),
    check(
      "agent.answer.citation_targets",
      stableCitationPages(servicePages, locationPages).length >= 2 ? "pass" : stableCitationPages(servicePages, locationPages).length ? "warning" : "fail",
      stableCitationPages(servicePages, locationPages).length >= 2 ? "present_valid" : stableCitationPages(servicePages, locationPages).length ? "present_invalid" : "not_detected",
      `${stableCitationPages(servicePages, locationPages).length} canonical service or location citation target(s) were detected.`,
      contentEvidence("agent.answer.citation_targets.content", `Citation targets: ${stableCitationPages(servicePages, locationPages).map((page) => page.url).join(", ") || "none"}.`, generatedAt, sourceUrl),
      "inferred",
      confidence
    ),

    check("agent.basic.home_reachable", crawl.fetched && (crawl.status ?? 500) < 400 ? "pass" : "fail", crawl.fetched && (crawl.status ?? 500) < 400 ? "present_valid" : "present_invalid", crawl.fetched ? `The canonical homepage returned HTTP ${crawl.status ?? "unknown"}.` : `The canonical homepage could not be fetched: ${crawl.error ?? "unknown error"}.`, httpEvidence("agent.basic.home_reachable.http", `Final homepage response: ${crawl.status ?? "unavailable"}.`, generatedAt, sourceUrl)),
    check("agent.basic.https", new URL(sourceUrl).protocol === "https:" ? "pass" : "fail", new URL(sourceUrl).protocol === "https:" ? "present_valid" : "present_invalid", new URL(sourceUrl).protocol === "https:" ? "The canonical website uses HTTPS." : "The canonical website remained on HTTP.", httpEvidence("agent.basic.https.http", `Canonical assessed URL: ${sourceUrl}.`, generatedAt, sourceUrl)),

    check("agent.discoverability.robots", probes.robots.found ? "pass" : probeStatus(findProbe(probes, "robots_txt"), "warning"), probes.robots.found ? "present_valid" : "not_detected", probes.robots.found ? "robots.txt was fetched and parsed." : "No usable robots.txt was detected.", probeEvidence("agent.discoverability.robots.http", findProbe(probes, "robots_txt"), generatedAt)),
    check("agent.discoverability.sitemap", crawl.sitemapFound ? "pass" : "warning", crawl.sitemapFound ? "present_valid" : "not_detected", crawl.sitemapFound ? "An XML sitemap was discovered." : "No XML sitemap was discovered.", httpEvidence("agent.discoverability.sitemap.http", `Sitemap discovered: ${crawl.sitemapFound}.`, generatedAt, sourceUrl)),
    check("agent.discoverability.link_headers", usefulLinkHeader ? "pass" : html?.error ? "unknown" : "warning", usefulLinkHeader ? "present_valid" : linkHeader ? "present_invalid" : html?.error ? "not_tested" : "not_detected", usefulLinkHeader ? `Useful same-site HTTP Link metadata was detected: ${linkHeader.slice(0, 500)}.` : linkHeader ? `Link metadata was present but did not contain a valid same-site canonical or discovery target: ${linkHeader.slice(0, 500)}.` : "No useful HTTP Link discovery metadata was detected.", probeEvidence("agent.discoverability.link_headers.http", html, generatedAt, linkHeader || "No Link header detected.")),

    check("agent.content.markdown_negotiation", markdownAvailable ? "pass" : markdown?.error ? "unknown" : "warning", markdownAvailable ? "present_valid" : markdownResponse || markdown?.ok ? "present_invalid" : markdown?.error ? "not_tested" : "not_detected", markdownAvailable ? "The homepage returned a substantive text/markdown representation when requested." : markdownResponse ? "The homepage returned text/markdown, but the representation was empty or insubstantial." : markdown?.ok ? `The Markdown request returned ${markdown.contentType ?? "an unspecified content type"}.` : "Markdown content negotiation was not detected.", probeEvidence("agent.content.markdown_negotiation.http", markdown, generatedAt)),
    check("agent.content.markdown_parity", !markdownAvailable ? "unknown" : markdownParity >= 0.8 ? "pass" : markdownParity >= 0.5 ? "warning" : "fail", !markdownAvailable ? "not_tested" : markdownParity >= 0.8 ? "present_valid" : "present_invalid", !markdownAvailable ? "Markdown parity could not be assessed because no Markdown representation was available." : `The Markdown representation retained ${Math.round(markdownParity * 100)}% of the sampled key business facts.`, probeEvidence("agent.content.markdown_parity.content", markdown, generatedAt, `Key-fact parity: ${Math.round(markdownParity * 100)}%.`)),
    check("agent.content.llms_txt", validLlms(llms) ? "pass" : llms?.error ? "unknown" : "warning", validLlms(llms) ? "present_valid" : llms?.ok ? "present_invalid" : llms?.error ? "not_tested" : "not_detected", validLlms(llms) ? "A structured llms.txt with useful links was detected." : llms?.ok ? "llms.txt responded but did not contain a heading and useful HTTP links." : "No usable llms.txt was detected.", probeEvidence("agent.content.llms_txt.http", llms, generatedAt)),

    check(
      "agent.bot.ai_rules",
      blockedAnswerAgents.length ? "fail" : probes.robots.aiAgents.length ? "pass" : probes.robots.found ? "warning" : "unknown",
      blockedAnswerAgents.length ? "present_invalid" : probes.robots.aiAgents.length ? "present_valid" : probes.robots.found ? "not_detected" : "not_tested",
      blockedAnswerAgents.length
        ? `Root access was explicitly blocked for answer or user-triggered agents: ${blockedAnswerAgents.join(", ")}.`
        : probes.robots.aiAgents.length
          ? `Explicit rules were detected for ${probes.robots.aiAgents.join(", ")}${probes.robots.blockedAiAgents.length ? `; root access was blocked for ${probes.robots.blockedAiAgents.join(", ")}` : ""}.`
          : probes.robots.found
            ? "robots.txt did not contain an explicit rule group for a recognized AI crawler."
            : "AI crawler rules could not be assessed without robots.txt.",
      probeEvidence("agent.bot.ai_rules.robots", findProbe(probes, "robots_txt"), generatedAt)
    ),
    check("agent.bot.content_signals", completeContentSignals(probes) ? "pass" : probes.robots.contentSignals ? "warning" : probes.robots.found ? "warning" : "unknown", completeContentSignals(probes) ? "present_valid" : probes.robots.contentSignals ? "present_invalid" : probes.robots.found ? "not_detected" : "not_tested", completeContentSignals(probes) ? "Content Signals declare search, AI input, and AI training preferences." : probes.robots.contentSignals ? "Content Signals were present but incomplete." : probes.robots.found ? "No Content-Signal directive was detected." : "Content Signals could not be assessed without robots.txt.", probeEvidence("agent.bot.content_signals.robots", findProbe(probes, "robots_txt"), generatedAt)),
    capabilityCheck("agent.bot.web_bot_auth", agentCapability || validJsonProbe(webAuth), webAuth, generatedAt),

    capabilityCheck("agent.protocol.agent_skills", agentCapability || validJsonProbe(skills), skills, generatedAt),
    capabilityCheck("agent.protocol.api_catalog", apiCapability || validJsonProbe(apiCatalog), apiCatalog, generatedAt),
    capabilityCheck("agent.protocol.oauth_authorization_server", oauthCapability || validJsonProbe(oauthAuthorization), oauthAuthorization, generatedAt),
    capabilityCheck("agent.protocol.oauth_protected_resource", oauthCapability || validJsonProbe(oauthProtected), oauthProtected, generatedAt),
    capabilityCheck("agent.protocol.mcp_server_card", mcpCapability || validJsonProbe(mcp), mcp, generatedAt),
    check("agent.protocol.webmcp", agentCapability || capabilities.webMcp ? capabilities.webMcp ? "pass" : "warning" : "not_applicable", capabilities.webMcp ? "present_valid" : "not_detected", capabilities.webMcp ? "WebMCP tool registration was detected in first-party HTML." : agentCapability ? "An agent capability was detected, but WebMCP registration was not." : "No browser-agent capability was advertised, so WebMCP was not applicable.", contentEvidence("agent.protocol.webmcp.content", `WebMCP signature detected: ${capabilities.webMcp}.`, generatedAt, sourceUrl)),

    check("agent.commerce.x402", commerceCapability ? capabilities.x402 ? "pass" : "warning" : "not_applicable", capabilities.x402 ? "present_valid" : "not_detected", capabilities.x402 ? "An x402 payment signal was detected." : commerceCapability ? "On-domain agentic commerce was detected without an x402 signal." : "No on-domain transactional capability was detected, so x402 was not applicable.", contentEvidence("agent.commerce.x402.content", `On-domain commerce: ${onDomainCommerce}; x402 signal: ${capabilities.x402}.`, generatedAt, sourceUrl)),
    capabilityCheck("agent.commerce.ucp", commerceCapability, ucp, generatedAt),
    capabilityCheck("agent.commerce.acp", commerceCapability, acp, generatedAt)
  ];
  return { checks, limitations: probes.limitations };
}

export function agentReadinessForArtifact(input: {
  artifact: SiteBuildArtifact;
  buildInput: SitePublicBuildInput;
  generatedAt: string;
}) {
  const { artifact, buildInput, generatedAt } = input;
  const structuredIdentity = artifact.factBindings.some((binding) => binding.origin === "structured_data" && binding.text.includes(buildInput.business.name));
  const offerings = buildInput.business.offerings.filter((offering) => offering.status === "confirmed" && offering.visibility === "public");
  const hasLocation = Boolean(buildInput.business.locations.length || buildInput.business.serviceAreas.length);
  const serviceOrLocationRoutes = artifact.routes.filter((route) => /\b(service|location|contact|area)\b/i.test(`${route.path} ${route.title} ${route.description}`));
  const overrides = new Map<string, AgentReadinessCheckInput>([
    ["agent.answer.entity_consistency", artifactCheck("agent.answer.entity_consistency", structuredIdentity ? "pass" : "warning", structuredIdentity ? "present_valid" : "not_detected", structuredIdentity ? "The retained artifact binds the verified business name into structured data." : "The retained artifact does not prove that a matching machine-readable business identity rendered.", artifact, generatedAt)],
    ["agent.answer.service_location_coverage", artifactCheck("agent.answer.service_location_coverage", offerings.length && hasLocation ? "pass" : offerings.length || hasLocation ? "warning" : "fail", offerings.length && hasLocation ? "present_valid" : "present_invalid", `${offerings.length} verified public offering(s) and ${hasLocation ? "verified location or service-area facts" : "no verified location or service-area facts"} were available.`, artifact, generatedAt, "inferred", 0.95)],
    ["agent.answer.direct_answers", artifactCheck("agent.answer.direct_answers", buildInput.domainContext ? "unknown" : "not_applicable", "not_tested", buildInput.domainContext ? "The artifact retained vertical guidance, but not enough rendered prose to prove direct answer coverage." : "No verified vertical module was available, so category-specific answer coverage was not applied.", artifact, generatedAt)],
    ["agent.answer.extractable_content", artifactCheck("agent.answer.extractable_content", artifact.factBindings.length ? "warning" : "unknown", artifact.factBindings.length ? "present_invalid" : "not_tested", artifact.factBindings.length ? "Source-bound facts were retained, but the artifact assessment does not preserve a complete semantic-text extraction." : "Semantic answer content requires a rendered or published assessment.", artifact, generatedAt)],
    ["agent.answer.citation_targets", artifactCheck("agent.answer.citation_targets", serviceOrLocationRoutes.length >= 2 ? "pass" : serviceOrLocationRoutes.length ? "warning" : "fail", serviceOrLocationRoutes.length >= 2 ? "present_valid" : serviceOrLocationRoutes.length ? "present_invalid" : "not_detected", `${serviceOrLocationRoutes.length} descriptive service or location route(s) were retained as potential citation targets.`, artifact, generatedAt, "inferred", 0.9)]
  ]);

  const checks = agentReadinessCheckDefinitions.map((definition) => {
    const override = overrides.get(definition.id);
    if (override) return override;
    if (definition.applicability === "capability") {
      return artifactCheck(definition.id, "not_applicable", "not_detected", "No corresponding public agent, API, OAuth, MCP, WebMCP, or on-domain commerce capability was declared in the retained artifact.", artifact, generatedAt);
    }
    return artifactCheck(definition.id, "unknown", "not_tested", "This check depends on the real published HTTP serving boundary and cannot be proven from a retained site artifact.", artifact, generatedAt);
  });
  return {
    checks,
    limitations: [
      "Agent Readiness was assessed from retained artifact evidence; public HTTP headers, robots policy, Markdown negotiation, llms.txt, and well-known resources require a published-site assessment.",
      "The generated-site hard gate remains authoritative. Agent Readiness findings are advisory."
    ]
  };
}

function check(
  id: string,
  status: AssessmentCriterionStatus,
  alignment: AgentReadinessAlignment,
  explanation: string,
  evidence: AssessmentEvidence,
  certainty: "deterministic" | "inferred" | "human_reviewed" = "deterministic",
  confidence?: number
) {
  return agentReadinessCheck({ id, status, alignment, explanation, evidence, certainty, confidence });
}

function capabilityCheck(
  id: string,
  applicable: boolean,
  observation: AgentReadinessProbeObservation | undefined,
  observedAt: string
) {
  const valid = validJsonProbe(observation);
  const status: AssessmentCriterionStatus = !applicable
    ? "not_applicable"
    : valid
      ? "pass"
      : observation?.error || observation?.skipped
        ? "unknown"
        : "warning";
  return check(
    id,
    status,
    valid ? "present_valid" : observation?.ok ? "present_invalid" : observation?.error || observation?.skipped ? "not_tested" : "not_detected",
    !applicable
      ? "No corresponding public capability was advertised, so this discovery standard was not applicable."
      : valid
        ? `Valid JSON discovery metadata was detected at ${observation?.finalUrl ?? observation?.url}.`
        : observation?.ok
          ? "The discovery resource responded but was not a valid JSON object."
          : observation?.error
            ? `The discovery resource could not be verified: ${observation.error}`
            : "The applicable discovery resource was not detected.",
    probeEvidence(`${id}.http`, observation, observedAt)
  );
}

function artifactCheck(
  id: string,
  status: AssessmentCriterionStatus,
  alignment: AgentReadinessAlignment,
  explanation: string,
  artifact: SiteBuildArtifact,
  observedAt: string,
  certainty: "deterministic" | "inferred" | "human_reviewed" = "deterministic",
  confidence?: number
) {
  return check(id, status, alignment, explanation, {
    id: `${id}.artifact`,
    kind: "artifact_gate",
    summary: `${explanation} Hard gate: ${artifact.qa.hardGate}; retained routes: ${artifact.routes.length}.`.slice(0, 2_000),
    observedAt
  }, certainty, confidence);
}

function probeStatus(observation: AgentReadinessProbeObservation | undefined, missing: AssessmentCriterionStatus) {
  return observation?.error || observation?.skipped ? "unknown" : missing;
}

function probeEvidence(id: string, observation: AgentReadinessProbeObservation | undefined, observedAt: string, summary?: string): AssessmentEvidence {
  const bodyExcerpt = observation?.body?.trim()
    ? `; response excerpt: ${observation.body.trim().replace(/\s+/g, " ").slice(0, 600)}`
    : "";
  return {
    id,
    kind: "http",
    summary: (summary ?? (observation
      ? `URL: ${observation.url}; final URL: ${observation.finalUrl ?? "unavailable"}; status: ${observation.status ?? "unavailable"}; content type: ${observation.contentType ?? "unavailable"}${observation.linkHeader ? `; Link: ${observation.linkHeader.slice(0, 500)}` : ""}${observation.error ? `; error: ${observation.error}` : ""}${bodyExcerpt}.`
      : "The bounded HTTP probe did not produce an observation.")).slice(0, 2_000),
    sourceUrl: observation?.url,
    observedAt
  };
}

function httpEvidence(id: string, summary: string, observedAt: string, sourceUrl: string): AssessmentEvidence {
  return { id, kind: "http", summary, sourceUrl, observedAt };
}

function contentEvidence(id: string, summary: string, observedAt: string, sourceUrl: string): AssessmentEvidence {
  return { id, kind: "content", summary: summary.slice(0, 2_000), sourceUrl, observedAt };
}

function completeContentSignals(probes: AgentReadinessProbeResult) {
  const signals = probes.robots.contentSignals;
  return Boolean(signals?.search && signals.aiInput && signals.aiTrain);
}

function validLlms(observation: AgentReadinessProbeObservation | undefined) {
  if (!observation?.ok || !observation.body) return false;
  const contentType = observation.contentType?.toLowerCase() ?? "";
  const usefulMarkdownLinks = [...observation.body.matchAll(/\]\((https?:\/\/[^)\s]+)\)/gi)]
    .map((match) => match[1])
    .some((value) => {
      try {
        const linked = new URL(value);
        return sameSite(linked.hostname, new URL(observation.finalUrl ?? observation.url).hostname)
          && /\.md(?:$|[?#])/i.test(linked.pathname);
      } catch {
        return false;
      }
    });
  return (contentType.includes("text/plain") || contentType.includes("text/markdown"))
    && /^#\s+\S+/m.test(observation.body)
    && usefulMarkdownLinks;
}

function hasUsefulLinkHeader(value: string, sourceUrl: string) {
  if (!value) return false;
  for (const match of value.matchAll(/<([^>]+)>\s*;([^,]*)/g)) {
    const relations = match[2].match(/\brel\s*=\s*["']?([^"';,\s]+)/i)?.[1]?.toLowerCase().split(/\s+/) ?? [];
    if (!relations.some((relation) => ["alternate", "canonical", "api-catalog", "mcp-server", "agent-skills"].includes(relation))) continue;
    try {
      const target = new URL(match[1], sourceUrl);
      if (["http:", "https:"].includes(target.protocol) && sameSite(target.hostname, new URL(sourceUrl).hostname)) return true;
    } catch {
      // Malformed Link targets remain an observed warning.
    }
  }
  return false;
}

function keyFactParity(markdown: string, crawl: CrawlAssessment) {
  const facts = [
    crawl.extractedFacts.name,
    crawl.extractedFacts.phone,
    formattedLocation(crawl),
    ...crawl.extractedFacts.services.slice(0, 3)
  ].filter((value): value is string => Boolean(value))
    .map(normalized)
    .filter((value) => value.length >= 3);
  if (!facts.length) {
    const title = normalized(crawl.title ?? "");
    return title && normalized(markdown).includes(title) ? 1 : 0;
  }
  const haystack = normalized(markdown);
  return facts.filter((fact) => haystack.includes(fact)).length / facts.length;
}

function localBusinessSchema(html: string | undefined) {
  if (!html) return [] as Record<string, unknown>[];
  const values: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      flattenJson(JSON.parse(match[1]), values);
    } catch {
      // Invalid JSON-LD is represented as no valid LocalBusiness node.
    }
  }
  return values.filter((value) => {
    const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
    return types.some((type) => typeof type === "string" && localBusinessTypePattern.test(type));
  });
}

function flattenJson(value: unknown, target: Record<string, unknown>[]) {
  if (Array.isArray(value)) {
    for (const item of value) flattenJson(item, target);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  target.push(record);
  if (record["@graph"]) flattenJson(record["@graph"], target);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function addressValue(value: unknown) {
  if (typeof value === "string") return value.trim() || undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const address = value as Record<string, unknown>;
  const parts = ["streetAddress", "addressLocality", "addressRegion", "postalCode"]
    .map((key) => stringValue(address[key]))
    .filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(", ") : undefined;
}

function digits(value: string) {
  return value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

function locationMatches(left: string, right: string) {
  const leftValue = normalized(left);
  const rightValue = normalized(right);
  return leftValue.includes(rightValue) || rightValue.includes(leftValue);
}

function stableCitationPages(servicePages: CrawlAssessment["pageSummaries"], locationPages: CrawlAssessment["pageSummaries"]) {
  return [...new Map([...servicePages, ...locationPages]
    .filter((page) => Boolean(page.canonical && page.title && (page.mainText?.length ?? 0) >= 200))
    .map((page) => [page.url, page])).values()];
}

function formattedLocation(crawl: CrawlAssessment) {
  const address = crawl.extractedFacts.address;
  if (!address) return undefined;
  const value = [address.street, address.city, address.region, address.postalCode].filter(Boolean).join(", ");
  return value || undefined;
}

function directQuestionCount(value: string) {
  return [...value.matchAll(/\b(?:what|how|when|where|who|why|do|does|can|is|are|will|which)\b[^?\n]{4,160}\?/gi)].length;
}

function uniqueNormalized(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value))
    .map(normalized)
    .filter(Boolean))];
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function sameSite(left: string, right: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/^www\./, "");
  return normalize(left) === normalize(right);
}
