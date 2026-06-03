import type { GenerationQaBlocker, GenerationQaRepairLog, SiteBundle, SiteVersion } from "./models";
import { galleryImageAssetsForBusiness, heroImageAssetForBusiness } from "./image-registry";
import { applyPropsToLayoutSection, repairLayoutDocument, syncVersionLegacySections } from "./layout-registry";
import { pruneUnsupportedCatalogSections } from "./section-catalog";

export type GeneratedSiteAiRepairMode = "normal_generation" | "operator_premium_generation";

export function maxAiGeneratedSiteRepairRetries(mode: GeneratedSiteAiRepairMode) {
  return mode === "operator_premium_generation" ? 2 : 1;
}

export function shouldAttemptAiGeneratedSiteRepair(input: { attempts: number; mode: GeneratedSiteAiRepairMode }) {
  return input.attempts < maxAiGeneratedSiteRepairRetries(input.mode);
}

export function applyDeterministicGeneratedSiteRepair(input: {
  bundle: SiteBundle;
  version: SiteVersion;
  blockers: GenerationQaBlocker[];
  attemptedAt?: string;
}): GenerationQaRepairLog {
  const attemptedAt = input.attemptedAt ?? new Date().toISOString();
  const mutationSummaries: string[] = [];
  const unresolved = new Set(input.blockers.map((blocker) => blocker.id));

  if (input.version.status === "published" || input.version.ownerTouched || input.version.ownerApprovedAt) {
    return {
      attempted: true,
      applied: false,
      attemptedAt,
      mutationSummaries: ["Repair skipped because the version is published, owner-touched, or owner-approved."],
      unresolvedBlockerIds: Array.from(unresolved)
    };
  }

  const homePage = input.version.pages[0];
  const hero = homePage?.layoutSections.find((section) => section.kind === "hero");
  let placeholderSanitized = false;
  let catalogPruned = false;

  for (const blocker of input.blockers) {
    const normalizedId = blocker.id.replace(/^(desktop|tablet|mobile)_/, "");
    if ((normalizedId === "hero_h1_oversized" || normalizedId === "cta_below_fold") && hero) {
      hero.spacing = "compact";
      hero.mobileBehavior = "content_first";
      const brief = input.bundle.presenceAssessment.generationBrief;
      if (normalizedId === "hero_h1_oversized" && brief?.headline) {
        applyPropsToLayoutSection(hero, { heading: compactHeadline(brief.headline) });
      }
      mutationSummaries.push("Compacted hero typography and media height so the CTA fits above the fold.");
      unresolved.delete(blocker.id);
    }

    if (normalizedId === "layout_required_slot_missing") {
      const layoutRepair = repairLayoutDocument(input.version);
      if (layoutRepair.applied) {
        mutationSummaries.push(...layoutRepair.mutationSummaries);
        unresolved.delete(blocker.id);
      }
    }

    if (normalizedId === "placeholder_visible" || normalizedId.startsWith("claim_placeholder_")) {
      if (!placeholderSanitized) {
        placeholderSanitized = replacePlaceholderCopy(input.bundle, input.version);
      }
      if (placeholderSanitized) {
        if (!mutationSummaries.includes("Removed generic placeholder copy from generated section props.")) {
          mutationSummaries.push("Removed generic placeholder copy from generated section props.");
        }
        unresolved.delete(blocker.id);
      }
    }

    if (normalizedId.startsWith("catalog_") && input.bundle.presenceAssessment.businessFactGraph) {
      if (!catalogPruned) {
        const pruning = pruneUnsupportedCatalogSections({
          bundle: input.bundle,
          version: input.version,
          factGraph: input.bundle.presenceAssessment.businessFactGraph,
          primaryGoal: input.bundle.presenceAssessment.generationPlanV2?.primaryGoal ?? "forms"
        });
        catalogPruned = pruning.removedSections.length > 0;
        if (catalogPruned) {
          mutationSummaries.push(`Removed ${pruning.removedSections.length} unsupported optional section${pruning.removedSections.length === 1 ? "" : "s"} missing safe source facts.`);
        }
      }
      if (catalogPruned) unresolved.delete(blocker.id);
    }

    if (normalizedId === "generic_image") {
      const changed = replaceGenericImages(input.bundle, input.version);
      if (changed) {
        mutationSummaries.push("Replaced generic imagery with curated vertical registry assets.");
        unresolved.delete(blocker.id);
      }
    }

    if (normalizedId === "sticky_cta_overlap") {
      input.version.presentation = {
        mobileActionBehavior: "after_hero",
        reservedMobileActionSpace: true
      };
      mutationSummaries.push("Changed mobile sticky CTA behavior to render after the hero.");
      unresolved.delete(blocker.id);
    }
  }

  if (mutationSummaries.length) syncVersionLegacySections(input.version);

  return {
    attempted: true,
    applied: mutationSummaries.length > 0,
    attemptedAt,
    mutationSummaries,
    unresolvedBlockerIds: Array.from(unresolved)
  };
}

function replacePlaceholderCopy(bundle: SiteBundle, version: SiteVersion) {
  let changed = false;
  const serviceFacts = bundle.presenceAssessment.generationBrief?.renderableFacts
    .filter((fact) => fact.field === "services")
    .map((fact) => String(fact.value))
    .filter(Boolean) ?? bundle.businessProfile.services;
  const replacementService = serviceFacts[0] ?? bundle.businessProfile.categories[0] ?? "Service details";
  const replacementArea = bundle.businessProfile.address?.city ?? bundle.businessProfile.serviceAreas[0] ?? "local";

  for (const page of version.pages) {
    for (const section of page.layoutSections) {
      for (const component of Object.values(section.slots).flat()) {
        for (const [key, value] of Object.entries(component.props)) {
          const next = sanitizePlaceholderValue(value, {
            businessName: bundle.businessProfile.name,
            replacementArea,
            replacementService
          });
          if (next.changed) {
            component.props[key] = next.value;
            changed = true;
          }
        }
      }
    }
  }
  return changed;
}

function sanitizePlaceholderValue(
  value: unknown,
  replacements: {
    businessName: string;
    replacementArea: string;
    replacementService: string;
  }
): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    const next = sanitizePlaceholderString(value, replacements);
    return { value: next, changed: next !== value };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const sanitized = sanitizePlaceholderValue(item, replacements);
      changed ||= sanitized.changed;
      return sanitized.value;
    });
    return { value: next, changed };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const sanitized = sanitizePlaceholderValue(item, replacements);
      changed ||= sanitized.changed;
      next[key] = sanitized.value;
    }
    return { value: next, changed };
  }
  return { value, changed: false };
}

function sanitizePlaceholderString(
  value: string,
  replacements: {
    businessName: string;
    replacementArea: string;
    replacementService: string;
  }
) {
  return value
    .replace(/\bCore service\b/g, replacements.replacementService)
    .replace(/\bLocal area\b/g, replacements.replacementArea)
    .replace(/\bLocal support\b/g, "Clear contact options")
    .replace(/\bSample Local Business\b/g, replacements.businessName)
    .replace(/\bCredential details can be verified\b/gi, "Direct contact details")
    .replace(/\bVisual proof slot ready\b/gi, "Service photos and examples")
    .replace(/\bProject proof should use owner-approved photos and descriptions after claim\. The preview reserves the conversion-critical slot\./gi, "Project examples can highlight completed work when photos are available.")
    .replace(/\bVerified reviews, credentials, and owner-approved testimonials make the decision easier\./gi, "Clear services, contact details, and project examples make the decision easier.")
    .replace(/\bAdd owner-approved review excerpts here after claim so trust proof stays accurate\./gi, "Contact the team for current project details and customer references.")
    .replace(/\bEach service page becomes more specific as verified facts, photos, and owner-approved details are added\./gi, "Each service page keeps the request path clear with the facts available today.")
    .replace(/\bDo you help customers in nearby customers\?/gi, "Do you serve local customers?")
    .replace(/\bYes\. Owner-truth details, offers, photos, and FAQs are editable and should be verified during claim\./gi, "Yes. Contact the business for current service details, photos, and FAQs.")
    .replace(/\bReady to request more information\?/gi, "Ready to request an estimate?")
    .replace(/\bowner-approved\b/gi, "business-provided")
    .replace(/\bowner-truth\b/gi, "business")
    .replace(/\bcan be verified\b/gi, "is available")
    .replace(/\bnearby customers customers\b/gi, "nearby customers")
    .replace(/\blocal customers customers\b/gi, "local customers");
}

function replaceGenericImages(bundle: SiteBundle, version: SiteVersion) {
  let changed = false;
  const heroAsset = heroImageAssetForBusiness(bundle.businessProfile);
  const galleryAssets = galleryImageAssetsForBusiness(bundle.businessProfile);
  for (const page of version.pages) {
    for (const section of page.layoutSections) {
      if (section.kind === "hero") {
        applyPropsToLayoutSection(section, { imageUrl: heroAsset.url, alt: heroAsset.alt });
        changed = true;
      }
      if (section.kind === "gallery") {
        applyPropsToLayoutSection(section, {
          images: galleryAssets.map((asset) => ({
            url: asset.url,
            alt: asset.alt,
            label: asset.label
          }))
        });
        changed = true;
      }
    }
  }
  return changed;
}

function compactHeadline(value: string) {
  if (value.length <= 82) return value;
  const sentence = value.split(/[.!?]/)[0]?.trim();
  return sentence && sentence.length <= 82 ? sentence : `${value.slice(0, 78).trim()}...`;
}
