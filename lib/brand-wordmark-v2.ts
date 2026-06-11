import { createHash } from "node:crypto";
import type { BusinessProfile, SiteArtifactRecord, Theme } from "./models";
import type { SiteArtDirectionFontPairingIdV3 } from "./models";

/**
 * Deterministic typographic wordmark candidates — REVIEW-ONLY.
 *
 * The brand-mark legal gate (lib/brand-mark-generation-v2.ts) blocks any
 * generated mark from public output pending product/legal approval. This
 * module implements the gate's required mechanism: candidates are stored as
 * review-only artifacts and are never serialized into public site output.
 * `allowedPublicOutput` is hard-coded false here; flipping it is a deliberate
 * post-approval change, not a config option.
 *
 * Inputs are deliberately limited to the business NAME (a verified fact), a
 * curated font pairing, and the theme palette — never scraped logos, favicons,
 * or reference imagery (prohibited by the gate).
 */

export type WordmarkCandidateV2 = {
  version: "wordmark-candidate-v1";
  svg: string;
  fontPairingId: SiteArtDirectionFontPairingIdV3;
  allowedPublicOutput: false;
};

const wordmarkFontFamilies: Record<string, string> = {
  editorial_serif_clean_sans: "Fraunces, Georgia, serif",
  condensed_service_sans: "Archivo, sans-serif",
  warm_editorial_sans: "Fraunces, Georgia, serif",
  precision_grotesk: "'Libre Franklin', sans-serif",
  friendly_rounded: "Figtree, sans-serif",
  magazine_grotesk: "'Space Grotesk', sans-serif",
  quiet_serif: "'Cormorant Garamond', Georgia, serif",
  display_sans_humanist: "Sora, sans-serif"
};

export function generateWordmarkCandidateV2(input: {
  business: BusinessProfile;
  theme: Theme;
  fontPairingId: SiteArtDirectionFontPairingIdV3;
}): WordmarkCandidateV2 {
  const name = escapeXml(input.business.name.trim());
  const family = wordmarkFontFamilies[input.fontPairingId] ?? "Sora, sans-serif";
  const ink = input.theme.colors.text;
  const accent = input.theme.colors.accent;
  // Width estimate keeps the viewBox proportional; review surfaces re-measure.
  const estimatedWidth = Math.max(120, Math.round(input.business.name.trim().length * 16) + 36);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${estimatedWidth} 48" role="img" aria-label="${name} wordmark candidate">`,
    `<text x="0" y="34" font-family="${family}" font-size="30" font-weight="700" letter-spacing="-0.5" fill="${ink}">${name}<tspan fill="${accent}">.</tspan></text>`,
    `</svg>`
  ].join("");
  return {
    version: "wordmark-candidate-v1",
    svg,
    fontPairingId: input.fontPairingId,
    allowedPublicOutput: false
  };
}

export function wordmarkCandidateArtifactV2(input: {
  siteCandidateId: string;
  candidate: WordmarkCandidateV2;
  createdAt?: string;
}): SiteArtifactRecord {
  const payload = {
    candidate: input.candidate,
    reviewOnly: true,
    gate: "blocked_pending_product_legal",
    note: "Review-only wordmark candidate. Public use requires the brand-mark gate approvals (see lib/brand-mark-generation-v2.ts)."
  };
  return {
    id: `${input.siteCandidateId}_wordmark_candidate`,
    siteCandidateId: input.siteCandidateId,
    scope: "candidate_alternative",
    artifactType: "brand_mark_generation_report",
    artifactVersion: "wordmark-candidate-v1",
    producerId: "brand-wordmark-v2",
    producerVersion: "wordmark-candidate-v1",
    sourceFactIds: [],
    contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    payload,
    createdAt: input.createdAt ?? new Date().toISOString()
  };
}

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}
