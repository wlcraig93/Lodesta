import type { EditableField } from "@/components/SectionEditorForm";
import { getVisualSectionV3, type VisualSectionV3 } from "./generated-site-v3-visual-controls";
import { type PageV3 } from "./site-version-v3";
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
