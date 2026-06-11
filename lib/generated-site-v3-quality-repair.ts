import type { GenerationQaRepairLog, GenerationQualityReport, SiteBundle, SiteVersion, SiteVersionV3 } from "./models";
import { getVisualSectionV3, withVisualSectionV3, type VisualSectionV3 } from "./generated-site-v3-visual-controls";
import { isDynamicHoursStatus } from "./business-understanding-v2";
import { detectInternalStateCopy, findDuplicateTitles, isFillerFact } from "./generation-quality-v2";

/**
 * One-shot mechanical repair for layout-v3 quality findings: dedupes repeated
 * items, removes filler facts, strips internal-state eyebrows, and drops stale
 * hours entries. Content-generation problems (generic copy, missing media) are
 * not repairable here and stay blocking.
 */
export function applyGeneratedSiteV3QualityRepair(input: {
  bundle: SiteBundle;
  version: SiteVersion;
  report: GenerationQualityReport;
  attemptedAt?: string;
}): GenerationQaRepairLog {
  const attemptedAt = input.attemptedAt ?? new Date().toISOString();
  const unresolved = new Set(input.report.findings.filter((finding) => finding.severity === "blocking").map((finding) => finding.id));
  const mutationSummaries: string[] = [];

  if (input.version.rendererVersion !== "layout-v3") {
    return { attempted: true, applied: false, attemptedAt, mutationSummaries: [], unresolvedBlockerIds: [...unresolved] };
  }
  if (input.version.status === "published" || input.version.ownerTouched || input.version.ownerApprovedAt) {
    return {
      attempted: true,
      applied: false,
      attemptedAt,
      mutationSummaries: ["Repair skipped because the version is published, owner-touched, or owner-approved."],
      unresolvedBlockerIds: [...unresolved]
    };
  }

  const version = input.version as SiteVersionV3;
  for (const page of version.pageComposition.pages) {
    for (const section of page.sections) {
      const visual = getVisualSectionV3(section.props);
      if (!visual) continue;
      let changed = false;
      const next = structuredClone(visual) as VisualSectionV3;
      const slots = next.slots as Record<string, unknown>;

      changed = dedupeItemsSlot(slots) || changed;
      changed = removeFillerFacts(slots) || changed;
      changed = stripInternalEyebrow(slots) || changed;
      changed = dropStaleLocationHours(slots) || changed;

      if (changed) {
        section.props = withVisualSectionV3({ ...section.props }, next);
        mutationSummaries.push(`Repaired ${section.id} (${next.templateId}): removed duplicated, filler, or internal content.`);
      }
    }
  }

  if (mutationSummaries.length) {
    for (const findingId of [...unresolved]) {
      if (findingId.startsWith("duplicate_items_") || findingId === "filler_facts_visible" || findingId === "internal_state_visible") {
        unresolved.delete(findingId);
      }
    }
  }

  return {
    attempted: true,
    applied: mutationSummaries.length > 0,
    attemptedAt,
    mutationSummaries,
    unresolvedBlockerIds: [...unresolved]
  };
}

function dedupeItemsSlot(slots: Record<string, unknown>): boolean {
  const itemsSlot = slots.items;
  if (!itemsSlot || typeof itemsSlot !== "object" || !("items" in itemsSlot)) return false;
  const list = (itemsSlot as { items: unknown }).items;
  if (!Array.isArray(list)) return false;
  const titles = list.map((item) => titleForItem(item) ?? "");
  if (!findDuplicateTitles(titles.filter(Boolean)).length) return false;
  const seen = new Set<string>();
  const deduped = list.filter((item) => {
    const key = (titleForItem(item) ?? "").toLowerCase().trim();
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  (itemsSlot as { items: unknown }).items = deduped.map((item, index) =>
    item && typeof item === "object" && "meta" in (item as Record<string, unknown>)
      ? { ...(item as Record<string, unknown>), meta: String(index + 1).padStart(2, "0") }
      : item
  );
  return true;
}

function titleForItem(item: unknown): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const record = item as Record<string, unknown>;
  if (typeof record.title === "string") return record.title;
  if (typeof record.question === "string") return record.question;
  return undefined;
}

function removeFillerFacts(slots: Record<string, unknown>): boolean {
  let changed = false;
  for (const key of ["facts", "contact"]) {
    const slot = slots[key];
    if (!slot || typeof slot !== "object") continue;
    const record = slot as Record<string, unknown>;
    const listKey = Array.isArray(record.items) ? "items" : Array.isArray(record.facts) ? "facts" : undefined;
    if (!listKey) continue;
    const list = record[listKey] as unknown[];
    const filtered = list.filter((fact) => {
      if (!fact || typeof fact !== "object") return true;
      const label = (fact as { label?: unknown }).label;
      const value = (fact as { value?: unknown }).value;
      return !(typeof label === "string" && typeof value === "string" && isFillerFact(label, value));
    });
    if (filtered.length !== list.length) {
      record[listKey] = filtered;
      changed = true;
    }
  }
  return changed;
}

function stripInternalEyebrow(slots: Record<string, unknown>): boolean {
  let changed = false;
  for (const key of ["copy", "intro"]) {
    const slot = slots[key];
    if (!slot || typeof slot !== "object") continue;
    const record = slot as Record<string, unknown>;
    if (typeof record.eyebrow === "string" && detectInternalStateCopy(record.eyebrow)) {
      delete record.eyebrow;
      changed = true;
    }
  }
  return changed;
}

function dropStaleLocationHours(slots: Record<string, unknown>): boolean {
  const locationsSlot = slots.locations;
  if (!locationsSlot || typeof locationsSlot !== "object" || !("locations" in locationsSlot)) return false;
  const list = (locationsSlot as { locations: unknown }).locations;
  if (!Array.isArray(list)) return false;
  let changed = false;
  for (const location of list) {
    if (!location || typeof location !== "object") continue;
    const record = location as Record<string, unknown>;
    if (!Array.isArray(record.hours)) continue;
    const filtered = record.hours.filter((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const value = (entry as { value?: unknown }).value;
      const label = (entry as { label?: unknown }).label;
      if (typeof value !== "string") return false;
      if (isDynamicHoursStatus(value)) return false;
      if (typeof label === "string" && /^hours?[_\s-]*\d*$/i.test(label)) return false;
      return true;
    });
    if (filtered.length !== record.hours.length) {
      record.hours = filtered;
      changed = true;
    }
  }
  return changed;
}
