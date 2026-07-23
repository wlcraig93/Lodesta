import type { VerticalContextModule } from "@/packages/site-contracts";

export type CanonicalOfferingCandidate = {
  sourceName: string;
  catalogId?: string;
  name: string;
};

export function canonicalOfferingCandidates(serviceNames: string[], domainContext?: VerticalContextModule) {
  const seen = new Set<string>();
  const candidates: CanonicalOfferingCandidate[] = [];
  for (const sourceName of serviceNames) {
    if (isActionLabel(sourceName)) continue;
    const normalized = normalizedText(sourceName);
    const catalog = domainContext?.offeringCatalog.find((entry) =>
      [entry.name, ...entry.aliases].some((value) => normalized.includes(normalizedText(value)) || normalizedText(value).includes(normalized))
    );
    const identity = catalog ? `catalog:${catalog.id}` : `custom:${normalized}`;
    if (!normalized || seen.has(identity)) continue;
    seen.add(identity);
    candidates.push({ sourceName, ...(catalog ? { catalogId: catalog.id } : {}), name: catalog?.name ?? sourceName });
  }
  return candidates;
}

function isActionLabel(value: string) {
  return /^(?:request|get|schedule|book|contact|call|start|submit|view|learn|read|see)\b/i.test(value.trim());
}

function normalizedText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
