import type {
  BusinessProfile,
  GenerationQaBlockerCategory,
  RenderInspectionFinding,
  RenderInspectionResult,
  SiteBundle,
  SiteVersionV3
} from "./models";
import type { EvidenceKind, EvidenceLedger, VerifiedEvidence } from "./evidence-ledger";
import type { GenerationPlan, SiteCopy } from "./generation-contracts";
import { validateSiteCopyForPlan } from "./generation-contracts";
import { inspectGeneratedSiteBundleRender } from "./generated-site-render-inspection";
import { scanPlaceholderText, scanSensitiveClaimText, type SensitiveClaimEvidenceKind } from "./content-safety-scanners";
import { detectInternalStateCopy } from "./generation-objective-signals";
import { getVisualSectionV3 } from "./generated-site-v3-visual-controls";

export const objectiveGenerationGateSchemaVersion = "objective-generation-gate-v1" as const;

export type ObjectiveGateIssue = {
  id: string;
  title: string;
  detail: string;
  category: GenerationQaBlockerCategory;
  pageSlug?: string;
  viewport?: "desktop" | "tablet" | "mobile";
};

export type ObjectiveGenerationGateResult = {
  schemaVersion: typeof objectiveGenerationGateSchemaVersion;
  status: "pass" | "fail";
  evaluatedAt: string;
  qaRunId: string;
  blockers: ObjectiveGateIssue[];
  warnings: ObjectiveGateIssue[];
  routes: Array<{
    pageId: string;
    slug: string;
    inspection: RenderInspectionResult;
  }>;
};

export async function runObjectiveGenerationGate(input: {
  bundle: SiteBundle;
  version: SiteVersionV3;
  plan: GenerationPlan;
  copy: SiteCopy;
  evidence: EvidenceLedger;
  qaRunId: string;
  artifactRoot?: string;
  captureScreenshots?: boolean;
}): Promise<ObjectiveGenerationGateResult> {
  const routes = [];
  for (const page of input.version.pageComposition.pages) {
    const inspection = await inspectGeneratedSiteBundleRender({
      bundle: input.bundle,
      version: input.version,
      qaRunId: input.qaRunId,
      pageSlug: page.slug || undefined,
      artifactRoot: input.artifactRoot,
      captureScreenshots: input.captureScreenshots ?? true,
      captureSectionScreenshots: false
    });
    routes.push({ pageId: page.id, slug: page.slug, inspection });
  }
  return evaluateObjectiveGenerationGate({ ...input, routes });
}

export function evaluateObjectiveGenerationGate(input: {
  bundle: SiteBundle;
  version: SiteVersionV3;
  plan: GenerationPlan;
  copy: SiteCopy;
  evidence: EvidenceLedger;
  qaRunId: string;
  routes: ObjectiveGenerationGateResult["routes"];
}): ObjectiveGenerationGateResult {
  const blockers: ObjectiveGateIssue[] = [];
  const warnings: ObjectiveGateIssue[] = [];
  blockers.push(...contractBlockers(input));
  blockers.push(...contentBlockers(input.bundle.businessProfile, input.version, input.copy, input.evidence));
  for (const route of input.routes) {
    const pageSlug = route.slug || "/";
    const inspection = route.inspection;
    if (inspection.adapter !== "playwright" || inspection.unavailableReason) {
      blockers.push(issue(
        `route_browser_${route.pageId}`,
        "Route was not browser-inspected",
        inspection.unavailableReason ?? `Expected Playwright, received ${inspection.adapter}.`,
        "render_failed",
        pageSlug
      ));
    }
    if (inspection.metrics.siteHeaderDetected === false || inspection.metrics.siteFooterDetected === false) {
      blockers.push(issue(
        `route_chrome_${route.pageId}`,
        "Public route is missing site chrome",
        `Header detected: ${String(inspection.metrics.siteHeaderDetected)}; footer detected: ${String(inspection.metrics.siteFooterDetected)}.`,
        "render_failed",
        pageSlug
      ));
    }
    for (const viewport of ["desktop", "mobile"] as const) {
      const screenshot = inspection.screenshots.find((candidate) => candidate.viewport === viewport);
      if (!screenshot || (screenshot.bytes ?? 0) <= 0) {
        blockers.push(issue(
          `route_screenshot_${route.pageId}_${viewport}`,
          "Required route screenshot is empty",
          `${viewport} screenshot was not captured with nonzero bytes.`,
          "render_failed",
          pageSlug,
          viewport
        ));
      }
    }
    for (const finding of inspection.findings) {
      if (finding.severity === "fail") blockers.push(renderIssue(route.pageId, pageSlug, finding));
      if (finding.severity === "warning") warnings.push(renderIssue(route.pageId, pageSlug, finding));
    }
  }
  const dedupedBlockers = dedupeIssues(blockers);
  return {
    schemaVersion: objectiveGenerationGateSchemaVersion,
    status: dedupedBlockers.length ? "fail" : "pass",
    evaluatedAt: new Date().toISOString(),
    qaRunId: input.qaRunId,
    blockers: dedupedBlockers,
    warnings: dedupeIssues(warnings),
    routes: input.routes
  };
}

export function renderedTextManifest(version: SiteVersionV3) {
  return version.pageComposition.pages.map((page) => ({
    pageId: page.id,
    slug: page.slug,
    title: page.title,
    seo: page.seo,
    sections: page.sections.map((section) => ({
      sectionId: section.id,
      templateId: section.variant,
      text: textValues(getVisualSectionV3(section.props)?.slots)
    }))
  }));
}

function contractBlockers(input: {
  version: SiteVersionV3;
  plan: GenerationPlan;
  copy: SiteCopy;
  routes: ObjectiveGenerationGateResult["routes"];
}) {
  const blockers: ObjectiveGateIssue[] = [];
  const copyValidation = validateSiteCopyForPlan(input.plan, input.copy);
  for (const detail of copyValidation.issues) {
    blockers.push(issue("copy_contract", "Site copy contract failed", detail, "claim_unsupported"));
  }
  const pages = input.version.pageComposition.pages;
  const homepages = pages.filter((page) => page.slug === "" && page.purpose === "homepage");
  if (homepages.length !== 1) {
    blockers.push(issue("route_home", "Canonical homepage is invalid", `Expected one homepage, found ${homepages.length}.`, "render_failed"));
  }
  const slugs = new Set<string>();
  for (const page of pages) {
    if (slugs.has(page.slug)) blockers.push(issue(`route_duplicate_${page.id}`, "Duplicate route slug", `Duplicate slug /${page.slug}.`, "render_failed", page.slug || "/"));
    slugs.add(page.slug);
    if (page.slug && !/^services\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page.slug)) {
      blockers.push(issue(`route_slug_${page.id}`, "Route slug is invalid", `Unsupported public slug /${page.slug}.`, "render_failed", page.slug));
    }
    if (!page.seo.title.trim() || !page.seo.description.trim() || page.seo.canonicalPath !== (page.slug ? `/${page.slug}` : "/")) {
      blockers.push(issue(`seo_${page.id}`, "Basic SEO structure is invalid", "Title, description, or canonical path is missing or inconsistent.", "quality_failed", page.slug || "/"));
    }
    if (!page.sections.some((section) => section.family === "hero_split" || section.family === "hero_statement")) {
      blockers.push(issue(`hero_${page.id}`, "Route has no hero", "Every composed route requires one hero section.", "quality_failed", page.slug || "/"));
    }
    if (!page.sections.some((section) => section.family === "contact_split")) {
      blockers.push(issue(`contact_${page.id}`, "Route has no contact path", "Every composed route requires one contact section.", "quality_failed", page.slug || "/"));
    }
  }
  if (input.routes.length !== pages.length) {
    blockers.push(issue("route_count", "Not every route was inspected", `${input.routes.length}/${pages.length} routes were inspected.`, "render_failed"));
  }
  return blockers;
}

function contentBlockers(
  business: BusinessProfile,
  version: SiteVersionV3,
  copy: SiteCopy,
  evidence: EvidenceLedger
) {
  const blockers: ObjectiveGateIssue[] = [];
  const manifest = renderedTextManifest(version);
  const allText = manifest.flatMap((page) => page.sections.flatMap((section) => section.text)).join(" ");
  for (const match of scanPlaceholderText(allText)) {
    blockers.push(issue("placeholder_visible", "Placeholder or internal copy is visible", match.reason, "claim_unsupported"));
  }
  for (const value of manifest.flatMap((page) => page.sections.flatMap((section) => section.text))) {
    const reason = detectInternalStateCopy(value);
    if (reason) blockers.push(issue("internal_state_visible", "Internal generation state is visible", reason, "claim_unsupported"));
  }
  if (business.phone && !normalizedDigits(allText).includes(normalizedDigits(business.phone).slice(-7))) {
    blockers.push(issue("phone_grounding", "Known phone number is not rendered", "The source-backed phone number must appear on the generated site.", "data_incomplete"));
  }
  if (business.services.length && !business.services.some((service) => normalizedText(allText).includes(normalizedText(service)))) {
    blockers.push(issue("service_grounding", "Known services are not rendered", "At least one source-backed service name must appear on the generated site.", "data_incomplete"));
  }
  for (const slot of copy.slots) {
    const claims = scanSensitiveClaimText(slot.value).filter((claim) => claim.severity === "block" || claim.category === "pricing" || claim.category === "reviews" || claim.category === "marketing");
    for (const claim of claims) {
      const support = slot.evidenceIds
        .map((id) => evidence.items.find((candidate) => candidate.id === id))
        .filter((item): item is VerifiedEvidence => Boolean(item))
        .some((item) => supportsClaimKind(item, claim.requiredEvidence));
      if (!support) {
        blockers.push(issue(
          `sensitive_claim_${slot.slotId}_${claim.category}`,
          "Sensitive copy claim lacks verified support",
          `${slot.slotId} contains a ${claim.label} without compatible durable evidence.`,
          "claim_unsupported"
        ));
      }
    }
  }
  return blockers;
}

function supportsClaimKind(item: VerifiedEvidence, required: SensitiveClaimEvidenceKind) {
  if (item.renderPolicy !== "durable_render" || !item.publicText) return false;
  const compatible: Record<SensitiveClaimEvidenceKind, EvidenceKind[]> = {
    proof: ["credential", "years_in_business", "award", "warranty"],
    reviews: ["testimonial"],
    insurance: ["insurance_support"],
    pricing: ["offer"],
    emergency: []
  };
  return compatible[required].includes(item.kind);
}

function textValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(textValues);
  return Object.values(value).flatMap(textValues);
}

function normalizedText(value: string) {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizedDigits(value: string) {
  return value.replace(/\D/g, "");
}

function renderIssue(pageId: string, pageSlug: string, finding: RenderInspectionFinding): ObjectiveGateIssue {
  return issue(
    `${pageId}_${finding.id}`,
    finding.title,
    finding.evidence,
    finding.severity === "fail" ? "render_failed" : "quality_failed",
    pageSlug,
    finding.viewport
  );
}

function issue(
  id: string,
  title: string,
  detail: string,
  category: GenerationQaBlockerCategory,
  pageSlug?: string,
  viewport?: "desktop" | "tablet" | "mobile"
): ObjectiveGateIssue {
  return { id, title, detail, category, ...(pageSlug ? { pageSlug } : {}), ...(viewport ? { viewport } : {}) };
}

function dedupeIssues(issues: ObjectiveGateIssue[]) {
  const seen = new Set<string>();
  return issues.filter((candidate) => {
    const key = `${candidate.id}:${candidate.pageSlug ?? ""}:${candidate.viewport ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
