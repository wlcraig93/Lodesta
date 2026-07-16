import type { EditableField } from "@/components/SectionEditorForm";
import { compileSite } from "./site-compiler";
import { siteCopySchemaVersion, type SiteCopy } from "./generation-contracts";
import { getVisualSectionV3, type VisualSectionV3 } from "./generated-site-v3-visual-controls";
import { createRegenerableArtifactProvenanceV1 } from "./regenerable-artifact-provenance";
import { markVersionOwnerTouched } from "./site-version-metadata";
import { assertSiteVersionV3, findPageByIdV3, type PageV3 } from "./site-version-v3";
import type { SectionInstanceV3, SiteBundle, SiteVersionV3 } from "./models";

export type EditableV3Section = {
  section: SectionInstanceV3;
  page: PageV3;
  visual: VisualSectionV3;
  fields: EditableField[];
};

export function editableV3Sections(bundle: SiteBundle, version: SiteVersionV3): EditableV3Section[] {
  const editable: EditableV3Section[] = [];
  for (const page of version.pageComposition.pages) {
    for (const section of page.sections) {
      const visual = getVisualSectionV3(section.props);
      if (!visual) continue;
      const fields = editableFieldsForVisualSection(visual);
      if (fields.length) editable.push({ page, section, visual, fields });
    }
  }
  return editable;
}

export function designSectionsForV3(version: SiteVersionV3) {
  const home = version.pageComposition.pages.find((page) => page.slug === "") ?? version.pageComposition.pages[0];
  return (home?.sections ?? []).map((section) => {
    const visual = getVisualSectionV3(section.props);
    return {
      id: section.id,
      kind: visual?.templateId ?? section.family,
      label: visual ? copySlot(visual)?.heading ?? visual.templateId : section.family,
      preset: visual?.templateId ?? section.variant,
      presetOptions: [{ id: visual?.templateId ?? section.variant, label: visual?.templateId ?? section.variant }]
    };
  });
}

export function applyV3SectionUpdate(
  bundle: SiteBundle,
  input: { pageId: string; sectionId: string; props: Record<string, unknown> }
) {
  const current = assertSiteVersionV3(
    bundle.siteModel.versions.find((version) => version.status === "draft") ?? bundle.siteModel.versions[0],
    "canonical section update"
  );
  const page = findPageByIdV3(current, input.pageId);
  const section = page?.sections.find((candidate) => candidate.id === input.sectionId);
  const visual = section ? getVisualSectionV3(section.props) : undefined;
  if (!page || !section || !visual) return { ok: false as const, reason: "Unknown site, page, or section" };
  const plan = bundle.presenceAssessment.generationPlan;
  const sourceCopy = bundle.presenceAssessment.siteCopy;
  const evidence = bundle.presenceAssessment.evidenceLedger;
  const assets = bundle.presenceAssessment.assetInventory ?? [];
  if (!plan || !sourceCopy || !evidence) {
    return { ok: false as const, reason: "This site uses a stale generation schema. Regenerate it before editing." };
  }

  const copy = structuredClone(sourceCopy);
  const patched = patchCanonicalCopy(copy, plan, section.id, input.props);
  if (!patched.ok) return patched;
  copy.provenance = createRegenerableArtifactProvenanceV1({
    producerId: "owner-site-copy-edit",
    producerVersion: siteCopySchemaVersion,
    inputs: { previousCopy: sourceCopy, pageId: input.pageId, sectionId: input.sectionId, props: input.props }
  });
  const version = compileSite({ business: bundle.businessProfile, plan, copy, evidence, assets });
  markVersionOwnerTouched(version);
  bundle.siteModel.theme = version.theme ?? bundle.siteModel.theme;
  bundle.siteModel.versions = [version, ...bundle.siteModel.versions.filter((candidate) => candidate.status === "published")];
  bundle.presenceAssessment.siteCopy = copy;
  bundle.presenceAssessment.technicalNotes.push(`Owner copy edit recompiled stored plan ${plan.provenance.producerVersion}.`);
  return { ok: true as const, bundle };
}

function patchCanonicalCopy(
  copy: SiteCopy,
  plan: NonNullable<SiteBundle["presenceAssessment"]["generationPlan"]>,
  sectionId: string,
  props: Record<string, unknown>
) {
  const section = plan.pages.flatMap((page) => page.sections).find((candidate) => candidate.id === sectionId);
  if (!section) return { ok: false as const, reason: `Section ${sectionId} is not part of the stored generation plan.` };
  for (const [key, value] of Object.entries(props)) {
    if (key === "primaryCta") {
      return { ok: false as const, reason: "Action changes require explicit site regeneration." };
    }
    if (!["eyebrow", "heading", "body"].includes(key) || typeof value !== "string") {
      return { ok: false as const, reason: `Field ${key} is not a canonical copy slot.` };
    }
    const slotId = `${sectionId}.${key}`;
    const spec = section.copySlots.find((candidate) => candidate.slotId === slotId);
    const slot = copy.slots.find((candidate) => candidate.slotId === slotId);
    if (!spec || !slot) return { ok: false as const, reason: `Copy slot ${slotId} is unavailable.` };
    const cleaned = value.replace(/\s+/g, " ").trim();
    if (!cleaned) return { ok: false as const, reason: `${key} cannot be empty.` };
    if (cleaned.length > spec.maxCharacters) {
      return { ok: false as const, reason: `${key} must be ${spec.maxCharacters} characters or fewer.` };
    }
    slot.value = cleaned;
  }
  return { ok: true as const };
}

function editableFieldsForVisualSection(visual: VisualSectionV3): EditableField[] {
  const copy = copySlot(visual);
  const fields: EditableField[] = [];
  if (copy?.eyebrow) fields.push({ kind: "text", key: "eyebrow", label: "Eyebrow", value: copy.eyebrow, multiline: false });
  if (copy?.heading) fields.push({ kind: "text", key: "heading", label: "Heading", value: copy.heading, multiline: false });
  if (copy?.body) fields.push({ kind: "text", key: "body", label: "Body", value: copy.body, multiline: true });
  return fields;
}

function copySlot(visual: VisualSectionV3) {
  const slots = visual.slots as Record<string, unknown>;
  const candidate = slots.copy ?? slots.intro;
  return candidate && typeof candidate === "object"
    ? candidate as { eyebrow?: string; heading?: string; body?: string }
    : undefined;
}
