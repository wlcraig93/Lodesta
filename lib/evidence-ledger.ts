import { createHash } from "node:crypto";
import type { CrawlAssessment } from "./crawler";
import { createRegenerableArtifactProvenanceV1 } from "./regenerable-artifact-provenance";
import {
  canonicalSourceTokens,
  reconstructSourceTokenSpan,
  type SourceTextBlock
} from "./source-text-blocks";
import type { RegenerableArtifactProvenanceV1 } from "./models";

export const evidenceLedgerSchemaVersion = "evidence-ledger-v1" as const;

export type EvidenceKind =
  | "testimonial"
  | "credential"
  | "warranty"
  | "insurance_support"
  | "award"
  | "years_in_business"
  | "offer";

export type EvidenceProposal = {
  kind: EvidenceKind;
  proposedText: string;
  sourceUrl?: string;
  sourceBlockId?: string;
  attribution?: string;
};

export type EvidenceRenderPolicy = "durable_render" | "protected_preview" | "owner_confirmation";

export type VerifiedEvidence = {
  id: string;
  kind: EvidenceKind;
  sourceExcerpt: string;
  publicText?: string;
  attribution?: string;
  renderPolicy: EvidenceRenderPolicy;
  confirmation?: {
    status: "confirmed" | "rejected";
    decidedBy: string;
    decidedAt: string;
  };
  source: {
    url: string;
    pageHash: string;
    blockId: string;
    containerId: string;
    startToken: number;
    endToken: number;
  };
};

export function applyEvidenceConfirmation(input: {
  ledger: EvidenceLedger;
  evidenceId: string;
  decision: "confirmed" | "rejected";
  decidedBy: string;
  decidedAt?: string;
}) {
  const item = input.ledger.items.find((candidate) => candidate.id === input.evidenceId);
  if (!item) return { ok: false as const, reason: "Evidence item was not found." };
  if (item.renderPolicy === "durable_render") {
    return { ok: false as const, reason: "This evidence is already deterministically renderable and does not require confirmation." };
  }
  item.confirmation = {
    status: input.decision,
    decidedBy: input.decidedBy,
    decidedAt: input.decidedAt ?? new Date().toISOString()
  };
  if (input.decision === "confirmed") {
    item.renderPolicy = "durable_render";
    item.publicText = item.sourceExcerpt;
  }
  return { ok: true as const, item };
}

export type EvidenceRejectionReason =
  | "empty_proposal"
  | "source_block_not_found"
  | "quote_not_contiguous"
  | "testimonial_too_short"
  | "testimonial_too_long"
  | "short_proof_too_short";

export type EvidenceRejection = {
  kind: EvidenceKind;
  proposedText: string;
  reason: EvidenceRejectionReason;
};

export type EvidenceLedger = {
  schemaVersion: typeof evidenceLedgerSchemaVersion;
  provenance: RegenerableArtifactProvenanceV1;
  items: VerifiedEvidence[];
  rejected: EvidenceRejection[];
  yield: {
    proposed: number;
    accepted: number;
    rejected: number;
    acceptanceRate: number;
    rejectedByReason: Partial<Record<EvidenceRejectionReason, number>>;
    sourceBlockCount: number;
    sourceSparse: boolean;
  };
};

export function composeEvidenceLedger(input: {
  crawl: CrawlAssessment | undefined;
  proposals?: EvidenceProposal[];
  createdAt?: string;
}): EvidenceLedger {
  const blocks = input.crawl?.pageSummaries.flatMap((page) => page.sourceTextBlocks ?? []) ?? [];
  const proposals = input.proposals ?? [];
  const items: VerifiedEvidence[] = [];
  const rejected: EvidenceRejection[] = [];

  for (const proposal of proposals) {
    const result = verifyEvidenceProposal(proposal, blocks);
    if (result.ok) items.push(result.item);
    else rejected.push({ kind: proposal.kind, proposedText: proposal.proposedText, reason: result.reason });
  }

  const deduped = dedupeEvidence(items);
  const rejectedByReason = rejected.reduce<Partial<Record<EvidenceRejectionReason, number>>>((counts, item) => {
    counts[item.reason] = (counts[item.reason] ?? 0) + 1;
    return counts;
  }, {});
  return {
    schemaVersion: evidenceLedgerSchemaVersion,
    provenance: createRegenerableArtifactProvenanceV1({
      producerId: "compose-evidence-ledger",
      producerVersion: evidenceLedgerSchemaVersion,
      createdAt: input.createdAt,
      inputs: {
        sourcePages: input.crawl?.pageSummaries.map((page) => ({
          url: page.url,
          sourceTextBlocks: page.sourceTextBlocks
        })),
        proposals
      }
    }),
    items: deduped,
    rejected,
    yield: {
      proposed: proposals.length,
      accepted: deduped.length,
      rejected: rejected.length,
      acceptanceRate: proposals.length ? deduped.length / proposals.length : 1,
      rejectedByReason,
      sourceBlockCount: blocks.length,
      sourceSparse: blocks.length < 3 || blocks.reduce((sum, block) => sum + block.canonicalTokens.length, 0) < 40
    }
  };
}

export function verifyEvidenceProposal(
  proposal: EvidenceProposal,
  blocks: SourceTextBlock[]
): { ok: true; item: VerifiedEvidence } | { ok: false; reason: EvidenceRejectionReason } {
  const proposedText = proposal.proposedText.trim();
  if (!proposedText) return { ok: false, reason: "empty_proposal" };
  const proposedTokens = canonicalSourceTokens(proposedText).map((token) => token.value);
  const minimum = proposal.kind === "testimonial" ? 7 : 2;
  if (proposedTokens.length < minimum) {
    return { ok: false, reason: proposal.kind === "testimonial" ? "testimonial_too_short" : "short_proof_too_short" };
  }
  if (proposal.kind !== "testimonial" && proposedText.length < 6) {
    return { ok: false, reason: "short_proof_too_short" };
  }

  const eligibleBlocks = blocks.filter((block) => {
    if (proposal.sourceBlockId && block.id !== proposal.sourceBlockId) return false;
    return !proposal.sourceUrl || normalizedUrl(block.sourceUrl) === normalizedUrl(proposal.sourceUrl);
  });
  if (!eligibleBlocks.length) return { ok: false, reason: "source_block_not_found" };

  for (const block of eligibleBlocks) {
    const startToken = contiguousTokenIndex(block.canonicalTokens.map((token) => token.value), proposedTokens);
    if (startToken < 0) continue;
    const endToken = startToken + proposedTokens.length;
    const sourceExcerpt = reconstructSourceTokenSpan(block, startToken, endToken);
    if (!sourceExcerpt) continue;
    if (proposal.kind === "testimonial" && sourceExcerpt.length < 40) {
      return { ok: false, reason: "testimonial_too_short" };
    }
    if (proposal.kind === "testimonial" && sourceExcerpt.length > 240) {
      return { ok: false, reason: "testimonial_too_long" };
    }
    const normalized = normalizePublicEvidence(proposal.kind, block.displayText, sourceExcerpt);
    const renderPolicy = renderPolicyFor(proposal.kind, normalized);
    const attribution = verifiedAdjacentAttribution(proposal, block, blocks);
    return {
      ok: true,
      item: {
        id: `evidence_${proposal.kind}_${hash(`${block.id}:${startToken}:${endToken}`)}`,
        kind: proposal.kind,
        sourceExcerpt,
        ...(proposal.kind === "testimonial"
          ? { publicText: sourceExcerpt }
          : normalized
            ? { publicText: normalized }
            : {}),
        ...(attribution ? { attribution } : {}),
        renderPolicy,
        source: {
          url: block.sourceUrl,
          pageHash: block.sourcePageHash,
          blockId: block.id,
          containerId: block.containerId,
          startToken,
          endToken
        }
      }
    };
  }
  return { ok: false, reason: "quote_not_contiguous" };
}

function normalizePublicEvidence(kind: EvidenceKind, blockText: string, sourceExcerpt: string) {
  if (!["credential", "insurance_support", "years_in_business"].includes(kind)) return undefined;
  if (hasUnsafeClaimContext(blockText)) return undefined;
  if (kind === "credential") {
    const credential = sourceExcerpt.match(
      /\b(?:I-CAR(?:\s+Gold Class)?|ASE(?:\s+Certified)?|OEM[-\s]?certified|factory[-\s]?certified|manufacturer[-\s]?certified|certified collision repair|BBB Accredited|licensed and insured)\b/i
    )?.[0];
    return credential?.replace(/\s+/g, " ").trim();
  }
  if (kind === "insurance_support") {
    if (/\bwork(?:s|ing)? with all insurance compan(?:y|ies)\b/i.test(sourceExcerpt)) return "Works with all insurance companies";
    if (/\bwork(?:s|ing)? with (?:your )?insurance compan(?:y|ies)\b/i.test(sourceExcerpt)) return "Works with insurance companies";
    if (/\b(?:insurance claims?|claim assistance|handle|manage)\b/i.test(sourceExcerpt)) return "Insurance claim assistance";
    return undefined;
  }
  const year = sourceExcerpt.match(/\b(?:since|established(?:\s+in)?|founded|opened|started)\b[^.]{0,80}?\b((?:19|20)\d{2})\b/i)?.[1];
  return year ? `Established ${year}` : undefined;
}

function hasUnsafeClaimContext(value: string) {
  return /\b(?:not|never|no longer|formerly|former|expired|until|unless|may|might|can apply|subject to|used to|previously)\b/i.test(value);
}

function renderPolicyFor(kind: EvidenceKind, normalized: string | undefined): EvidenceRenderPolicy {
  if (kind === "testimonial") return "durable_render";
  if (["warranty", "award", "offer"].includes(kind)) return "protected_preview";
  return normalized ? "durable_render" : "owner_confirmation";
}

function verifiedAdjacentAttribution(proposal: EvidenceProposal, block: SourceTextBlock, blocks: SourceTextBlock[]) {
  const attribution = proposal.attribution?.trim();
  if (!attribution || attribution === "Customer review") return undefined;
  const attributionTokens = canonicalSourceTokens(attribution).map((token) => token.value);
  if (!attributionTokens.length) return undefined;
  const adjacent = blocks.filter(
    (candidate) =>
      candidate.sourcePageHash === block.sourcePageHash &&
      Math.abs(candidate.order - block.order) <= 1
  );
  return adjacent.some((candidate) => contiguousTokenIndex(candidate.canonicalTokens.map((token) => token.value), attributionTokens) >= 0)
    ? attribution
    : undefined;
}

function contiguousTokenIndex(source: string[], candidate: string[]) {
  if (!candidate.length || candidate.length > source.length) return -1;
  for (let index = 0; index <= source.length - candidate.length; index += 1) {
    if (candidate.every((token, offset) => source[index + offset] === token)) return index;
  }
  return -1;
}

function normalizedUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href.replace(/\/$/, "");
  } catch {
    return value.replace(/\/$/, "");
  }
}

function dedupeEvidence(items: VerifiedEvidence[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.publicText ?? item.sourceExcerpt}`.toLocaleLowerCase("en-US");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
