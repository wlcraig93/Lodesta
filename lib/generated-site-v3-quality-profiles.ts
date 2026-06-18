import type {
  AssetAnalysisImageKindV1,
  AssetAnalysisWarningV1,
  AssetReference,
  BusinessProfile,
  GeneratedSiteCompilerDecisionV3,
  Vertical
} from "./models";
import type { StandardItemV3 } from "./generated-site-v3-visual-controls";

export type GeneratedSiteVerticalQualityProfileV1 = {
  id: "default_local_service" | "auto_body";
  label: string;
  verticals: readonly (Vertical | "default")[];
  proof: {
    blockedImageKinds: readonly AssetAnalysisImageKindV1[];
    blockedWarnings: readonly AssetAnalysisWarningV1[];
    blockedTextPattern: RegExp;
    requiresSourceBackedSpecificOutcome: boolean;
  };
  services: {
    semanticGroups: readonly GeneratedSiteServiceSemanticGroupV1[];
    largeFlatServiceTreatment: "designed_index" | "conservative_rows";
  };
  copy: {
    pseudoServicePattern: RegExp;
    unsupportedOutcomePattern: RegExp;
    awkwardPhrasePattern: RegExp;
  };
  media: {
    curatedFallbackCategories: readonly string[];
    curatedMediaMayBeProof: false;
  };
};

export type GeneratedSiteServiceSemanticGroupV1 = {
  id: string;
  title: string;
  pattern: RegExp;
};

export type GeneratedSiteMediaSlotV1 = "hero" | "service" | "proof" | "gallery" | "background";

export type GeneratedSiteMediaSuitabilityV1 =
  | { allowed: true }
  | { allowed: false; reason: string; evidence: string };

const universalPseudoServicePattern = /\b(free\s+)?(repair\s+)?(quote|estimate)|appointment|contact\s+us|get\s+a\s+free\b/i;
const universalUnsupportedOutcomePattern =
  /\b(before\s*\/?\s*after|before and after|after|transformation|transformed|result|results|restored|finished|repaired|fixed|review|testimonial|certified|licensed|insured|award)\b/i;

const defaultProfile: GeneratedSiteVerticalQualityProfileV1 = {
  id: "default_local_service",
  label: "Default Local Service",
  verticals: ["default"],
  proof: {
    blockedImageKinds: ["logo", "generic_graphic", "text_heavy_graphic", "low_quality", "unknown"],
    blockedWarnings: ["text_overlay", "logo_like", "collage_or_composite", "low_resolution", "blurry", "not_business_relevant", "rights_review_required"],
    blockedTextPattern: /\b(before|after|transformation|testimonial|review|award|certified|licensed|insured|logo|flyer|banner|screenshot|graphic|collage|composite|overlay)\b/i,
    requiresSourceBackedSpecificOutcome: true
  },
  services: {
    semanticGroups: [],
    largeFlatServiceTreatment: "conservative_rows"
  },
  copy: {
    pseudoServicePattern: universalPseudoServicePattern,
    unsupportedOutcomePattern: universalUnsupportedOutcomePattern,
    awkwardPhrasePattern: /\blists a\b|\bquote price is free\b|\bsite visitors?\b|\bthis website\b/i
  },
  media: {
    curatedFallbackCategories: ["context", "process", "service"],
    curatedMediaMayBeProof: false
  }
};

const autoBodyProfile: GeneratedSiteVerticalQualityProfileV1 = {
  id: "auto_body",
  label: "Auto Body",
  verticals: ["auto_body"],
  proof: {
    blockedImageKinds: ["logo", "generic_graphic", "text_heavy_graphic", "low_quality", "unknown"],
    blockedWarnings: ["text_overlay", "logo_like", "collage_or_composite", "low_resolution", "blurry", "not_business_relevant", "rights_review_required"],
    blockedTextPattern:
      /\b(before|after|before\s*&\s*after|before\s+and\s+after|transformation|transformed|full vehicle|color transformation|collage|composite|overlay|banner|flyer|graphic|screenshot|logo|watermark)\b/i,
    requiresSourceBackedSpecificOutcome: true
  },
  services: {
    semanticGroups: [
      { id: "collision_body", title: "Impact and Panel Repair", pattern: /\b(collision|auto\s*body|body\s*repair|panel|impact|frame)\b/i },
      { id: "paint_refinish", title: "Auto Paint and Refinishing", pattern: /\b(paint|refinish|color|clearcoat|primer)\b/i },
      { id: "pdr_dent", title: "Paintless Dent Repair", pattern: /\b(pdr|paintless|dent|ding)\b/i },
      { id: "hail", title: "Hail Damage Repair", pattern: /\bhail\b/i },
      { id: "bumper_panel", title: "Bumper and Panel Repair", pattern: /\b(bumper|fender|quarter|rocker|panel)\b/i },
      { id: "glass_trim", title: "Glass and Trim Damage", pattern: /\b(glass|windshield|window|trim)\b/i },
      { id: "claims", title: "Insurance Claim Support", pattern: /\b(insurance|claim|deductible|adjuster)\b/i },
      { id: "scratch_scuff", title: "Scratch and Scuff Repair", pattern: /\b(scratch|scuff)\b/i }
    ],
    largeFlatServiceTreatment: "designed_index"
  },
  copy: {
    pseudoServicePattern: universalPseudoServicePattern,
    unsupportedOutcomePattern: universalUnsupportedOutcomePattern,
    awkwardPhrasePattern: /\blists a Free Repair Quote\b|\bquote price is free\b|\bFree Repair Quote, and\b|\bsite visitors?\b|\bthis website\b/i
  },
  media: {
    curatedFallbackCategories: ["shop_environment", "repair_process", "service_detail", "paint_prep", "panel_fit"],
    curatedMediaMayBeProof: false
  }
};

export const generatedSiteVerticalQualityProfilesV1 = [autoBodyProfile, defaultProfile] as const;

export function generatedSiteVerticalQualityProfileForBusinessV1(
  business: Pick<BusinessProfile, "vertical">
): GeneratedSiteVerticalQualityProfileV1 {
  return generatedSiteVerticalQualityProfilesV1.find((profile) => profile.verticals.includes(business.vertical)) ?? defaultProfile;
}

export function qualityProfileAssignmentDecisionV1(profile: GeneratedSiteVerticalQualityProfileV1): GeneratedSiteCompilerDecisionV3 {
  return {
    id: `quality_profile.${profile.id}`,
    kind: "quality_profile_assignment",
    severity: "info",
    resolvedValue: profile.id,
    reason:
      profile.id === "default_local_service"
        ? "No tuned vertical profile matched; shared quality principles and the default local-service profile apply."
        : `${profile.label} profile applies vertical-specific service, proof, CTA, and media vocabulary.`
  };
}

export function mediaSuitabilityForProfileV1(input: {
  profile: GeneratedSiteVerticalQualityProfileV1;
  business: Pick<BusinessProfile, "photos">;
  item: { url: string; label: string };
  slot: GeneratedSiteMediaSlotV1;
}): GeneratedSiteMediaSuitabilityV1 {
  const asset = input.business.photos.find((photo) => mediaIdentityKeyV1(photo.url) === mediaIdentityKeyV1(input.item.url));
  const analysis = asset?.analysisV1?.version === "asset-analysis-v1" ? asset.analysisV1 : undefined;
  const labelText = `${input.item.url} ${input.item.label} ${asset?.alt ?? ""}`.trim();

  if (input.slot === "proof") {
    if (input.profile.proof.blockedTextPattern.test(labelText)) {
      return { allowed: false, reason: "proof_text_pattern", evidence: labelText.slice(0, 180) };
    }
    if (analysis?.imageKind && input.profile.proof.blockedImageKinds.includes(analysis.imageKind)) {
      return { allowed: false, reason: `proof_image_kind_${analysis.imageKind}`, evidence: analysis.summary.slice(0, 180) };
    }
    const blockedWarning = analysis?.warnings.find((warning) => input.profile.proof.blockedWarnings.includes(warning));
    if (blockedWarning) {
      return { allowed: false, reason: `proof_warning_${blockedWarning}`, evidence: analysis?.summary.slice(0, 180) ?? blockedWarning };
    }
    if (analysis && !analysis.usableSlots.includes("proof")) {
      return { allowed: false, reason: "proof_slot_not_recommended", evidence: analysis.summary.slice(0, 180) };
    }
  }

  if (analysis?.warnings.includes("not_business_relevant") || analysis?.warnings.includes("rights_review_required")) {
    return { allowed: false, reason: "media_not_business_relevant_or_rights_review", evidence: analysis.summary.slice(0, 180) };
  }
  return { allowed: true };
}

export function serviceSemanticGroupForProfileV1(
  profile: GeneratedSiteVerticalQualityProfileV1,
  serviceTitle: string
): GeneratedSiteServiceSemanticGroupV1 | undefined {
  return profile.services.semanticGroups.find((group) => group.pattern.test(serviceTitle));
}

export function semanticDedupeServiceItemsForProfileV1(input: {
  profile: GeneratedSiteVerticalQualityProfileV1;
  items: StandardItemV3[];
}): { items: StandardItemV3[]; decisions: GeneratedSiteCompilerDecisionV3[] } {
  const decisions: GeneratedSiteCompilerDecisionV3[] = [];
  const seen = new Set<string>();
  const seenBodies = new Set<string>();
  const items: StandardItemV3[] = [];
  for (const item of input.items) {
    if (input.profile.copy.pseudoServicePattern.test(item.title)) {
      decisions.push({
        id: `service_semantic_dedupe.pseudo.${normalizeServiceKeyV1(item.title)}`,
        kind: "service_semantic_dedupe",
        severity: "warning",
        requestedValue: item.title,
        resolvedValue: "dropped_pseudo_service",
        reason: `Dropped "${item.title}" because quote/contact CTAs cannot be rendered as services.`
      });
      continue;
    }
    const group = serviceSemanticGroupForProfileV1(input.profile, item.title);
    const semanticKey = group?.id ?? normalizeServiceKeyV1(item.title);
    const bodyKey = normalizeBodyKeyV1(item.body);
    if (seen.has(semanticKey)) {
      decisions.push({
        id: `service_semantic_dedupe.${semanticKey}`,
        kind: "service_semantic_dedupe",
        severity: "warning",
        requestedValue: item.title,
        resolvedValue: group?.title ?? semanticKey,
        reason: `Dropped source-equivalent service "${item.title}" because it maps to the already-rendered "${semanticKey}" service group.`
      });
      continue;
    }
    seen.add(semanticKey);
    const next = { ...item, title: group?.title ?? item.title };
    if (seenBodies.has(bodyKey)) {
      next.body = fallbackServiceBodyV1(input.profile, next.title);
      decisions.push({
        id: `service_semantic_dedupe_body.${semanticKey}`,
        kind: "service_semantic_dedupe",
        severity: "warning",
        requestedValue: item.body,
        resolvedValue: next.body,
        reason: `Rewrote duplicate body copy for "${next.title}" so rendered service cards do not share the same sentence.`
      });
    }
    seenBodies.add(normalizeBodyKeyV1(next.body));
    items.push(next);
  }
  return { items, decisions };
}

export function unsupportedProofCopyIssueV1(
  profile: GeneratedSiteVerticalQualityProfileV1,
  text: string
): string | undefined {
  if (profile.copy.pseudoServicePattern.test(text)) return "pseudo_service_copy_leaked";
  if (profile.copy.awkwardPhrasePattern.test(text)) return "awkward_profile_copy";
  if (profile.copy.unsupportedOutcomePattern.test(text)) return "unsupported_outcome_copy_requires_evidence";
  return undefined;
}

export function mediaIdentityKeyV1(url: string) {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/\?.*$/, "")
    .replace(/#.*$/, "");
}

function normalizeServiceKeyV1(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeBodyKeyV1(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function fallbackServiceBodyV1(profile: GeneratedSiteVerticalQualityProfileV1, title: string) {
  if (profile.id === "auto_body") {
    if (/paint/i.test(title)) return "Paint and refinish work starts with the panel condition, adjacent color, and edge details that affect the blend.";
    if (/dent|hail/i.test(title)) return "Dent work starts by checking paint condition, panel access, and whether trim or nearby edges are involved.";
    if (/glass|trim/i.test(title)) return "Glass or trim damage is checked with seals, clips, and nearby body fit before the next step is confirmed.";
    return "The shop starts with the damaged area, related panels, and whether the vehicle still drives normally.";
  }
  return `Start with the ${title.toLowerCase()} need, timing, and location so the business can confirm the best next step.`;
}
