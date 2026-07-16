import { createHash } from "node:crypto";
import type {
  BusinessProfile,
  GenerationQaMetadata,
  GenerationQaReadiness,
  RenderInspectionArtifactRef,
  RenderInspectionResult,
  RenderInspectionSummary,
  SeoMetadata,
  SiteBundle,
  SiteVersion
} from "./models";

export type SiteVersionPageSummary = {
  id: string;
  slug: string;
  title: string;
  seo: SeoMetadata;
};

export function sitePagesForVersion(version: SiteVersion): SiteVersionPageSummary[] {
  return version.pageComposition.pages;
}

export function getEffectiveGenerationQaReadiness(
  bundle: SiteBundle,
  version: SiteVersion
): GenerationQaReadiness {
  const qa = version.generationQa;
  if (!qa) return "unavailable";
  if (!qa.siteModelHash) return qa.readiness;
  return qa.siteModelHash === computeSiteModelHash(bundle, version) ? qa.readiness : "pending";
}

export function computeSiteModelHash(bundle: SiteBundle, version: SiteVersion) {
  const payload = {
    businessProfile: renderUsedBusinessFields(bundle.businessProfile),
    version: {
      rendererVersion: version.rendererVersion,
      designSchemaVersion: version.designSchemaVersion,
      pageComposition: version.pageComposition,
      mediaDecisions: version.mediaDecisions,
      artDirection: version.artDirection,
      theme: version.theme ?? bundle.siteModel.theme,
      presentation: version.presentation
    }
  };
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function markVersionOwnerTouched(version: SiteVersion) {
  version.ownerTouched = true;
  if (version.generationQa?.readiness === "ready" || version.generationQa?.readiness === "blocked") {
    version.generationQa = {
      ...version.generationQa,
      readiness: "pending"
    };
  }
}

export function markAllVersionsOwnerTouched(bundle: SiteBundle) {
  for (const version of bundle.siteModel.versions) markVersionOwnerTouched(version);
}

export function summarizeRenderInspection(result: RenderInspectionResult): {
  inspectionSummary: RenderInspectionSummary;
  artifactRefs: RenderInspectionArtifactRef[];
} {
  const failingFindingCount = result.findings.filter((finding) => finding.severity === "fail").length;
  const warningFindingCount = result.findings.filter((finding) => finding.severity === "warning").length;
  const sectionFindings = (result.sectionInspections ?? []).flatMap((section) => section.findings);
  const sectionFailingFindingCount = sectionFindings.filter((finding) => finding.severity === "fail").length;
  const sectionWarningFindingCount = sectionFindings.filter((finding) => finding.severity === "warning").length;
  return {
    inspectionSummary: {
      target: result.target,
      sourceUrl: result.sourceUrl,
      finalUrl: result.finalUrl,
      adapter: result.adapter,
      capturedAt: result.capturedAt,
      unavailableReason: result.unavailableReason,
      findingCount: result.findings.length,
      failingFindingCount,
      warningFindingCount,
      sectionInspectionCount: result.sectionInspections?.length,
      sectionFailingFindingCount,
      sectionWarningFindingCount,
      sectionScreenshotCount: result.sectionScreenshots?.length,
      metricsByViewport: result.metricsByViewport
    },
    artifactRefs: [...result.screenshots, ...(result.aboveFoldScreenshots ?? [])].map((screenshot) => ({
      viewport: screenshot.viewport,
      width: screenshot.width,
      height: screenshot.height,
      path: screenshot.path,
      bytes: screenshot.bytes,
      capturedAt: screenshot.capturedAt
    }))
  };
}

export function makePendingGenerationQa(siteModelHash: string): GenerationQaMetadata {
  return {
    schemaVersion: "canonical-generation-qa-v1",
    readiness: "pending",
    siteModelHash,
    blockers: [],
    warnings: []
  };
}

function renderUsedBusinessFields(profile: BusinessProfile) {
  return {
    name: profile.name,
    vertical: profile.vertical,
    categories: profile.categories,
    description: profile.description,
    phone: profile.phone,
    email: profile.email,
    address: profile.address,
    geo: profile.geo,
    hours: profile.hours,
    services: profile.services,
    credentials: profile.credentials,
    offers: profile.offers,
    serviceAreas: profile.serviceAreas,
    socialLinks: profile.socialLinks,
    bookingLinks: profile.bookingLinks,
    orderingLinks: profile.orderingLinks,
    photos: profile.photos,
    logo: profile.logo,
    reviewsSummary: profile.reviewsSummary,
    pressLinks: profile.pressLinks
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
