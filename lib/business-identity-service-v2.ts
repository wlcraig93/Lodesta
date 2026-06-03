import { createHash } from "node:crypto";
import type { BusinessFactKind, GenerationArtifactV2, SiteBundle, SiteVersion, SourceAwareFactV2 } from "./models";

export type IdentityFieldV2 = {
  field: Extract<BusinessFactKind, "name" | "phone" | "address" | "hours">;
  value?: unknown;
  status: "confirmed" | "missing" | "conflict" | "review";
  factIds: string[];
  confidence: number;
  notes: string[];
};

export type ServiceCatalogItemV2 = {
  id: string;
  name: string;
  status: "render_safe" | "review" | "blocked";
  evidenceFactIds: string[];
  confidence: number;
  sourcePolicy: string;
};

export type BusinessIdentityServiceV2Result = {
  skillId: "business.identity-reconcile";
  skillVersion: "direct-module-v1";
  versionId?: string;
  identity: IdentityFieldV2[];
  services: ServiceCatalogItemV2[];
  artifacts: GenerationArtifactV2[];
  summary: string;
};

export function runBusinessIdentityServiceAuditV2(input: {
  bundle: SiteBundle;
  version?: SiteVersion;
  siteId?: string;
  createdAt?: string;
}): BusinessIdentityServiceV2Result {
  const version = input.version ?? input.bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? input.bundle.siteModel.versions[0];
  const facts = sourceFactsForBundle(input.bundle);
  const identity = identityFields(input.bundle, facts);
  const services = serviceCatalog(input.bundle, facts);
  const artifacts = businessIdentityServiceArtifacts({
    siteId: input.siteId ?? input.bundle.businessProfile.siteId,
    versionId: version?.id,
    identity,
    services,
    createdAt: input.createdAt
  });
  const reviewCount = identity.filter((field) => field.status === "conflict" || field.status === "review").length + services.filter((service) => service.status === "review").length;
  return {
    skillId: "business.identity-reconcile",
    skillVersion: "direct-module-v1",
    versionId: version?.id,
    identity,
    services,
    artifacts,
    summary: `${identity.filter((field) => field.status === "confirmed").length} identity fields confirmed; ${services.filter((service) => service.status === "render_safe").length} render-safe services; ${reviewCount} review item${reviewCount === 1 ? "" : "s"}.`
  };
}

function identityFields(bundle: SiteBundle, facts: SourceAwareFactV2[]): IdentityFieldV2[] {
  return (["name", "phone", "address", "hours"] as const).map((field) => {
    const fieldFacts = facts.filter((fact) => fact.kind === field);
    const values = Array.from(new Set(fieldFacts.map((fact) => normalizeValue(fact.value))));
    const profileValue = profileValueForField(bundle, field);
    const renderableFacts = fieldFacts.filter((fact) => fact.renderPolicy === "durable_render" && fact.sourcePolicy === "durable_render");
    const status: IdentityFieldV2["status"] =
      !profileValue && !fieldFacts.length
        ? "missing"
        : values.length > 1
          ? "conflict"
          : renderableFacts.length || profileValue
            ? "confirmed"
            : "review";
    return {
      field,
      value: profileValue ?? fieldFacts[0]?.value,
      status,
      factIds: fieldFacts.map((fact) => fact.id),
      confidence: Math.max(...fieldFacts.map((fact) => fact.confidence), profileValue ? 0.74 : 0),
      notes: notesForIdentityField(field, status)
    };
  });
}

function serviceCatalog(bundle: SiteBundle, facts: SourceAwareFactV2[]): ServiceCatalogItemV2[] {
  const factServices = facts.filter((fact) => fact.kind === "service");
  const serviceNames = Array.from(new Set([...bundle.businessProfile.services, ...factServices.map((fact) => String(fact.value))].map((service) => service.trim()).filter(Boolean)));
  return serviceNames.map((name) => {
    const evidence = factServices.filter((fact) => normalizeValue(fact.value) === normalizeValue(name));
    const renderSafe = evidence.some((fact) => fact.renderPolicy === "durable_render" && fact.sourcePolicy === "durable_render");
    const blocked = evidence.some((fact) => fact.renderPolicy === "blocked" || fact.sourcePolicy === "blocked");
    return {
      id: `service_${slugify(name)}`,
      name,
      status: blocked ? "blocked" : renderSafe || !evidence.length ? "render_safe" : "review",
      evidenceFactIds: evidence.map((fact) => fact.id),
      confidence: Math.max(...evidence.map((fact) => fact.confidence), evidence.length ? 0 : 0.68),
      sourcePolicy: evidence[0]?.sourcePolicy ?? "profile_fallback"
    };
  });
}

function businessIdentityServiceArtifacts(input: {
  siteId: string;
  versionId?: string;
  identity: IdentityFieldV2[];
  services: ServiceCatalogItemV2[];
  createdAt?: string;
}): GenerationArtifactV2[] {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const identityPayload = { versionId: input.versionId, identity: input.identity };
  const servicesPayload = { versionId: input.versionId, services: input.services };
  const identityHash = hashPayload(identityPayload);
  const serviceHash = hashPayload(servicesPayload);
  return [
    {
      id: `artifact_${input.siteId}_identity_reconcile_${identityHash.slice(0, 16)}`,
      siteId: input.siteId,
      scope: "managed_site_candidate",
      artifactType: "identity_reconcile_report",
      artifactVersion: "identity-reconcile-report-v2",
      producerId: "business.identity-reconcile",
      producerVersion: "direct-module-v1",
      sourceFactIds: Array.from(new Set(input.identity.flatMap((field) => field.factIds))),
      contentHash: identityHash,
      payload: identityPayload,
      createdAt
    },
    {
      id: `artifact_${input.siteId}_service_catalog_${serviceHash.slice(0, 16)}`,
      siteId: input.siteId,
      scope: "managed_site_candidate",
      artifactType: "service_catalog_report",
      artifactVersion: "service-catalog-report-v2",
      producerId: "business.service-catalog",
      producerVersion: "direct-module-v1",
      sourceFactIds: Array.from(new Set(input.services.flatMap((service) => service.evidenceFactIds))),
      contentHash: serviceHash,
      payload: servicesPayload,
      createdAt
    }
  ];
}

function sourceFactsForBundle(bundle: SiteBundle) {
  return bundle.presenceAssessment.businessFactGraph?.sourceFactsV2 ?? [];
}

function profileValueForField(bundle: SiteBundle, field: IdentityFieldV2["field"]) {
  if (field === "name") return bundle.businessProfile.name;
  if (field === "phone") return bundle.businessProfile.phone;
  if (field === "address") return bundle.businessProfile.address;
  return bundle.businessProfile.hours;
}

function notesForIdentityField(field: IdentityFieldV2["field"], status: IdentityFieldV2["status"]) {
  if (status === "missing") return [`${field} is missing and may block or degrade generated-site readiness.`];
  if (status === "conflict") return [`${field} has conflicting sourced values and needs admin review before use.`];
  if (status === "review") return [`${field} exists but is not durable-render safe yet.`];
  return [`${field} is available for source-grounded rendering.`];
}

function normalizeValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(normalizeValue).sort().join("|");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined && item !== "")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${key}:${normalizeValue(item)}`)
      .join("|");
  }
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function slugify(value: string) {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
