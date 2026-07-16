import type { AssetReference, BusinessProfile } from "./models";

export type MediaFloorSlotV1 = "hero" | "background" | "proof" | "gallery";

export type MediaFloorSlotVerdictV1 =
  | { allowed: true; treatment: "standard" | "framed"; reason: string }
  | { allowed: false; reason: string };

export type MediaFloorVerdictV1 = Record<MediaFloorSlotV1, MediaFloorSlotVerdictV1>;

const mediaFloorSlotsV1: MediaFloorSlotV1[] = ["hero", "background", "proof", "gallery"];

const strictBlockedKinds = new Set(["text_heavy_graphic", "generic_graphic", "logo", "low_quality", "unknown"]);
const proofBlockedKinds = new Set(["text_heavy_graphic", "generic_graphic", "logo", "low_quality", "unknown"]);
const strictBlockedWarnings = new Set(["text_overlay", "logo_like", "collage_or_composite", "low_resolution", "blurry", "not_business_relevant"]);
const proofBlockedWarnings = new Set(["logo_like", "low_resolution", "blurry", "not_business_relevant"]);

export function mediaFloorVerdictV1(asset: AssetReference, business: Pick<BusinessProfile, "vertical">): MediaFloorVerdictV1 {
  return Object.fromEntries(mediaFloorSlotsV1.map((slot) => [slot, mediaFloorSlotVerdictV1(asset, business, slot)])) as MediaFloorVerdictV1;
}

export function mediaFloorAllowedUsesV1(asset: AssetReference, business: Pick<BusinessProfile, "vertical">): MediaFloorSlotV1[] {
  const verdict = mediaFloorVerdictV1(asset, business);
  return mediaFloorSlotsV1.filter((slot) => verdict[slot].allowed);
}

export function mediaFloorEffectiveWarningsV1(asset: AssetReference) {
  const analysis = asset.analysisV1;
  if (!analysis) return [];
  const dominantGraphicSignal = [analysis.summary, ...analysis.contentTags]
    .join(" ")
    .toLowerCase();
  const dominantGraphic = /\b(large|heavy|dominant|solid)[ _-]?(?:text|logo|graphic|color)?[ _-]?overlay\b|\b(wordmark|banner|flyer|graphic overlay)\b|\bobscur(?:e|ed|ing)\b/.test(dominantGraphicSignal);
  return analysis.warnings.filter((warning) => {
    // Vehicle badges and license plates are intrinsic scene details, not graphic overlays.
    // Keep the warnings for every other image kind so branded proof and composites
    // remain subject to the stricter framing/blocking rules.
    if (analysis.imageKind === "vehicle" && !dominantGraphic && (warning === "logo_like" || warning === "text_overlay")) return false;
    return true;
  });
}

export function mediaFloorSlotVerdictV1(
  asset: AssetReference,
  business: Pick<BusinessProfile, "vertical">,
  slot: MediaFloorSlotV1
): MediaFloorSlotVerdictV1 {
  if (business.vertical !== "auto_body") return { allowed: true, treatment: "standard", reason: "no_vertical_media_floor" };
  if (!isFirstPartyMediaV1(asset)) {
    return slot === "hero" || slot === "background" || slot === "gallery"
      ? { allowed: true, treatment: "standard", reason: "curated_media_fallback_allowed_for_context" }
      : { allowed: false, reason: "generic_media_cannot_supply_business_proof" };
  }
  if (!asset.analysisV1 || asset.analysisV1.version !== "asset-analysis-v1") {
    return { allowed: false, reason: "unanalyzed_media_does_not_beat_no_media_floor" };
  }

  return slot === "hero" || slot === "background"
    ? strictAutoBodyMediaVerdictV1(asset, slot)
    : proofGalleryAutoBodyMediaVerdictV1(asset, slot);
}

export function firstPartyMediaScoreV1(asset: AssetReference) {
  if (!asset.width || !asset.height) return 0.35;
  const aspect = asset.width / asset.height;
  let score = Math.min(asset.width, 1600) / 1600;
  if (aspect >= 1.15 && aspect <= 2.3) score += 1;
  if (asset.width >= 900 && asset.height >= 500) score += 0.4;
  if (aspect < 0.85) score -= 0.6;
  if (asset.analysisV1?.warnings.includes("collage_or_composite")) score -= 1;
  return score;
}

function strictAutoBodyMediaVerdictV1(asset: AssetReference, slot: "hero" | "background"): MediaFloorSlotVerdictV1 {
  const analysis = asset.analysisV1;
  if (!analysis) return { allowed: false, reason: "unanalyzed_media_does_not_beat_no_media_floor" };
  if (strictBlockedKinds.has(analysis.imageKind)) {
    return { allowed: false, reason: `media_kind_${analysis.imageKind}_does_not_beat_floor` };
  }
  const blockedWarning = mediaFloorEffectiveWarningsV1(asset).find((warning) => strictBlockedWarnings.has(warning));
  if (blockedWarning) return { allowed: false, reason: `media_warning_${blockedWarning}_does_not_beat_floor` };
  if (firstPartyMediaScoreV1(asset) < 1.15) {
    return { allowed: false, reason: "media_crop_quality_below_no_media_floor" };
  }
  return { allowed: true, treatment: "standard", reason: `clears_auto_body_${slot}_floor` };
}

function proofGalleryAutoBodyMediaVerdictV1(asset: AssetReference, slot: "proof" | "gallery"): MediaFloorSlotVerdictV1 {
  const analysis = asset.analysisV1;
  if (!analysis) return { allowed: false, reason: "unanalyzed_media_does_not_beat_no_media_floor" };
  if (proofBlockedKinds.has(analysis.imageKind)) {
    return { allowed: false, reason: `media_kind_${analysis.imageKind}_does_not_beat_floor` };
  }
  const effectiveWarnings = mediaFloorEffectiveWarningsV1(asset);
  const blockedWarning = effectiveWarnings.find((warning) => proofBlockedWarnings.has(warning));
  if (blockedWarning) return { allowed: false, reason: `media_warning_${blockedWarning}_does_not_beat_floor` };
  const isProofLike = analysis.imageKind === "before_after" || analysis.imageKind === "repair_detail";
  if (slot === "proof" && !isProofLike) return { allowed: false, reason: "media_kind_does_not_supply_completed_work_proof" };
  const needsFramedTreatment = effectiveWarnings.includes("text_overlay") || effectiveWarnings.includes("collage_or_composite");
  if (analysis.imageKind === "text_heavy_graphic" && !isProofLike) {
    return { allowed: false, reason: "media_kind_text_heavy_graphic_does_not_beat_floor" };
  }
  return {
    allowed: true,
    treatment: needsFramedTreatment ? "framed" : "standard",
    reason: needsFramedTreatment ? `clears_auto_body_${slot}_floor_with_framed_treatment` : `clears_auto_body_${slot}_floor`
  };
}

function isFirstPartyMediaV1(asset: AssetReference) {
  return asset.source === "uploaded" || asset.source === "website_reference";
}
