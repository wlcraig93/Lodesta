import { runBusinessIdentityServiceAuditV2 } from "./business-identity-service-v2";
import type { GenerationQaBlocker, GenerationQaWarning, SiteBundle, Vertical } from "./models";

export type PreCompileResolutionGateV2Result = {
  status: "ready" | "blocked";
  blockers: GenerationQaBlocker[];
  warnings: GenerationQaWarning[];
  artifactPayload: Record<string, unknown>;
};

export function evaluatePreCompileResolutionGateV2(bundle: SiteBundle): PreCompileResolutionGateV2Result {
  const audit = runBusinessIdentityServiceAuditV2({ bundle });
  const blockers: GenerationQaBlocker[] = [];
  const warnings: GenerationQaWarning[] = [];
  const business = bundle.businessProfile;
  const normalizedFacts = bundle.presenceAssessment.normalizedBusinessFacts;

  if (businessNameLooksDirty(business.name)) {
    blockers.push({
      id: "identity_dirty_name",
      title: "Business name needs resolution",
      detail: `The selected business name "${business.name}" looks like a page title or slogan rather than a business identity.`,
      category: "data_incomplete",
      severity: "blocking"
    });
  }

  if (requiresPhone(business.vertical) && !business.phone) {
    blockers.push({
      id: "identity_missing_phone",
      title: "Phone is missing",
      detail: `${business.vertical} generations need a source-backed phone path before a production-quality site can compile.`,
      category: "data_incomplete",
      severity: "blocking"
    });
  }

  if (requiresAddress(business.vertical, business.serviceAreas.length) && !business.address) {
    blockers.push({
      id: "identity_missing_address",
      title: "Address is missing",
      detail: `${business.vertical} generations need a source-backed address before rendering location, directions, or local proof sections.`,
      category: "data_incomplete",
      severity: "blocking"
    });
  }

  if (!business.hours) {
    warnings.push({
      id: "identity_missing_hours",
      title: "Hours unavailable",
      detail: "Hours were not source-backed. The site may render a call-to-confirm fallback but must not imply known hours."
    });
  }

  const sourceBackedServices = (normalizedFacts?.services ?? []).filter(
    (service) => service.source !== "system_default" && !serviceLooksLikeBusinessName(String(service.value), business.name)
  );
  if (requiresSourceBackedServices(business.vertical) && sourceBackedServices.length === 0) {
    blockers.push({
      id: "services_missing_source_backing",
      title: "Services need source-backed evidence",
      detail: "Only default or name-like service values were available. Compile is blocked so the site does not render a thin repeated service section.",
      category: "data_incomplete",
      severity: "blocking"
    });
  }

  return {
    status: blockers.length ? "blocked" : "ready",
    blockers,
    warnings,
    artifactPayload: {
      identity: audit.identity,
      services: audit.services,
      warnings,
      normalizedServiceSources: normalizedFacts?.services.map((service) => ({
        value: service.value,
        source: service.source,
        confidence: service.confidence
      })) ?? []
    }
  };
}

function businessNameLooksDirty(value: string) {
  return /[!?]/.test(value) || /\b(done right|welcome|official site|quality|best|affordable|professional)\b/i.test(value);
}

function requiresPhone(vertical: Vertical) {
  return vertical !== "creative_studio";
}

function requiresAddress(vertical: Vertical, serviceAreaCount: number) {
  if (vertical === "home_services" || vertical === "landscaping" || vertical === "general_local") return serviceAreaCount === 0;
  return true;
}

function requiresSourceBackedServices(vertical: Vertical) {
  return vertical !== "general_local";
}

function serviceLooksLikeBusinessName(service: string, businessName: string) {
  const normalizedService = normalizeText(service);
  const normalizedBusiness = normalizeText(businessName);
  if (!normalizedService || !normalizedBusiness) return false;
  if (normalizedService === normalizedBusiness) return true;
  if (normalizedService.includes(normalizedBusiness) || normalizedBusiness.includes(normalizedService)) return normalizedService.length > 12;
  const brandWords = normalizedBusiness
    .split(/\s+/)
    .filter((word) => !/^(auto|automotive|repair|body|paint|collision|service|services|shop|company|co|llc|inc)$/.test(word));
  const brandPhrase = brandWords.slice(0, 2).join(" ");
  return brandPhrase.length >= 4 && normalizedService.includes(brandPhrase);
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
