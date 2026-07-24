import type { VerticalContextModule } from "@/packages/site-contracts";

export type OfferingEvidence = {
  blocks: Array<{
    id: string;
    sourceUrl: string;
    evidenceClass: "first_party" | "third_party" | "unknown";
  }>;
  directPageUrls: string[];
  score: number;
};

export type CanonicalOfferingCandidate = {
  sourceName: string;
  catalogId?: string;
  name: string;
  evidence?: OfferingEvidence;
};

export function canonicalOfferingCandidates(
  serviceNames: string[],
  domainContext?: VerticalContextModule,
  options: {
    evidenceFor?: (sourceName: string) => OfferingEvidence;
    scoreBoostFor?: (candidate: { sourceName: string; catalogId?: string; name: string }) => number;
  } = {}
) {
  const candidates = new Map<string, CanonicalOfferingCandidate & { sourceIndex: number; rank: number }>();
  for (const [sourceIndex, sourceName] of serviceNames.entries()) {
    if (isActionLabel(sourceName)) continue;
    const normalized = normalizedText(sourceName);
    if (!normalized) continue;
    const catalog = bestCatalogMatch(sourceName, domainContext);
    if (isOfferingNoise(sourceName, Boolean(catalog))) continue;
    const evidence = options.evidenceFor?.(sourceName);
    const firstPartyBlocks = evidence?.blocks.filter((block) => block.evidenceClass === "first_party") ?? [];
    if (options.evidenceFor && !catalog && new Set(firstPartyBlocks.map((block) => block.id)).size < 2) continue;
    if (options.evidenceFor && catalog && !firstPartyBlocks.length && !evidence?.directPageUrls.length) continue;
    const identity = catalog ? `catalog:${catalog.id}` : `custom:${normalized}`;
    const candidate = {
      sourceName,
      ...(catalog ? { catalogId: catalog.id } : {}),
      name: catalog?.name ?? sourceName,
      ...(evidence ? { evidence } : {}),
      sourceIndex,
      rank: (evidence?.score ?? 0)
        + (catalog ? 20 : 0)
        + (options.scoreBoostFor?.({ sourceName, catalogId: catalog?.id, name: catalog?.name ?? sourceName }) ?? 0)
    };
    const existing = candidates.get(identity);
    if (!existing) {
      candidates.set(identity, candidate);
      continue;
    }
    if (candidate.rank > existing.rank) candidates.set(identity, candidate);
  }
  return [...candidates.values()]
    .sort((left, right) => right.rank - left.rank || left.sourceIndex - right.sourceIndex || left.name.localeCompare(right.name))
    .map(({ sourceIndex: _sourceIndex, rank: _rank, ...candidate }) => candidate);
}

function isActionLabel(value: string) {
  return /^(?:request|get|schedule|book|contact|call|start|submit|view|learn|read|see)\b/i.test(value.trim());
}

export function isOfferingNoise(value: string, matchedCatalog = false) {
  const normalized = normalizedText(value);
  if (!normalized) return true;
  if (/\b(?:faq|frequently asked questions?|tips?|guides?|blog|news|resources?|how to|do it yourself|diy)\b/.test(normalized)) return true;
  if (/\bnear me\b/.test(normalized)) return true;
  if (!matchedCatalog && /\b(?:best|top rated|affordable|cheap|company|companies|contractors?)\b/.test(normalized)) return true;
  if (/^(?:services?|repairs?|installations?|maintenance|solutions?|what we do|our work|learn more|read more)$/.test(normalized)) return true;
  return false;
}

function bestCatalogMatch(value: string, domainContext?: VerticalContextModule) {
  if (!domainContext) return undefined;
  const normalized = normalizedText(value);
  return domainContext.offeringCatalog
    .filter((entry) => entry.status === "active")
    .flatMap((entry) => [entry.name, ...entry.aliases].map((term) => {
      const normalizedTerm = normalizedText(term);
      const exact = normalized === normalizedTerm;
      const contained = includesPhrase(normalized, normalizedTerm);
      return { entry, score: exact ? 10_000 + normalizedTerm.length : contained ? normalizedTerm.length : -1 };
    }))
    .filter((match) => match.score >= 0)
    .sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id))[0]?.entry;
}

function includesPhrase(source: string, phrase: string) {
  return Boolean(phrase) && ` ${source} `.includes(` ${phrase} `);
}

function normalizedText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
