import { z } from "zod";
import type { RegenerableArtifactProvenanceV1, Theme } from "./models";

export const generationPlanSchemaVersion = "generation-plan-v1" as const;
export const siteCopySchemaVersion = "site-copy-v1" as const;

export type ShippingDesignSystemId = "precision_shop_editorial" | "trusted_local_service";

export type CopySlotSpec = {
  slotId: string;
  role: "eyebrow" | "heading" | "body" | "item_title" | "item_body" | "question" | "answer" | "seo_title" | "seo_description";
  maxCharacters: number;
  allowedEvidence: string[];
};

export type GenerationPlanSection = {
  id: string;
  templateId:
    | "hero_split"
    | "hero_statement"
    | "side_intro_rows"
    | "service_index"
    | "numbered_steps"
    | "quote_wall"
    | "faq_list"
    | "location_showcase"
    | "service_area_showcase"
    | "contact_split";
  mediaAssetId?: string;
  evidenceIds: string[];
  copySlots: CopySlotSpec[];
};

export type GenerationPlan = {
  schemaVersion: typeof generationPlanSchemaVersion;
  provenance: RegenerableArtifactProvenanceV1;
  designSystem: ShippingDesignSystemId;
  brandTokens: Theme;
  navigation: {
    items: Array<{ label: string; target: string; kind: "anchor" | "page" }>;
    primaryCta: { label: string; target: string };
  };
  pages: Array<{
    id: string;
    slug: string;
    purpose: "homepage" | "service_landing";
    title: string;
    sections: GenerationPlanSection[];
  }>;
  formId: string;
};

export type SiteCopy = {
  schemaVersion: typeof siteCopySchemaVersion;
  provenance: RegenerableArtifactProvenanceV1;
  slots: Array<{ slotId: string; value: string; evidenceIds: string[] }>;
};

const siteCopySlotSchema = z.object({
  slotId: z.string().min(1).max(160),
  value: z.string().min(1).max(900),
  evidenceIds: z.array(z.string().min(1).max(160)).max(8)
});

export const siteCopyResponseSchema = z.object({
  slots: z.array(siteCopySlotSchema).min(1).max(180)
});

export function validateSiteCopyForPlan(plan: GenerationPlan, copy: SiteCopy) {
  const specs = new Map(plan.pages.flatMap((page) => page.sections.flatMap((section) => section.copySlots)).map((slot) => [slot.slotId, slot]));
  const values = new Map<string, SiteCopy["slots"][number]>();
  const issues: string[] = [];
  for (const slot of copy.slots) {
    const spec = specs.get(slot.slotId);
    if (!spec) {
      issues.push(`Unknown copy slot: ${slot.slotId}`);
      continue;
    }
    if (values.has(slot.slotId)) issues.push(`Duplicate copy slot: ${slot.slotId}`);
    if (slot.value.length > spec.maxCharacters) issues.push(`Copy slot ${slot.slotId} exceeds ${spec.maxCharacters} characters.`);
    const allowed = new Set(spec.allowedEvidence);
    for (const evidenceId of slot.evidenceIds) {
      if (!allowed.has(evidenceId)) issues.push(`Copy slot ${slot.slotId} cites disallowed evidence ${evidenceId}.`);
    }
    values.set(slot.slotId, slot);
  }
  for (const slotId of specs.keys()) {
    if (!values.has(slotId)) issues.push(`Missing copy slot: ${slotId}`);
  }
  return { ok: issues.length === 0, issues, values };
}

export function copySlotValue(copy: SiteCopy, slotId: string) {
  const slot = copy.slots.find((candidate) => candidate.slotId === slotId);
  if (!slot) throw new Error(`Missing required copy slot ${slotId}.`);
  return slot.value;
}
