import { createHash } from "node:crypto";
import type {
  ClaimCategoryV2,
  ClaimSpanV2,
  CopyArtifactV2,
  SourceAwareFactPolicy
} from "./models";

export const localBusinessCopyProducerV2 = {
  id: "copy.local-business-marketing",
  version: "direct-module-v1"
} as const;

export function createLocalBusinessCopyArtifactV2(input: {
  slotId: string;
  text: string;
  category: ClaimCategoryV2;
  factIds: string[];
  verticalPlaybookVersion: string;
  sectionContractVersion: string;
  producerId?: string;
  producerVersion?: string;
  renderPolicy?: SourceAwareFactPolicy;
  sourcePolicy?: SourceAwareFactPolicy;
  status?: CopyArtifactV2["status"];
}): CopyArtifactV2 {
  const normalized = normalizeClaimTextV2(input.text);
  const claimSpans: ClaimSpanV2[] = input.factIds.length
    ? [
        {
          id: claimIdV2({ sourceFactIds: input.factIds, category: input.category, normalizedClaimValue: normalized }),
          sourceFactIds: input.factIds,
          category: input.category,
          normalizedClaimValue: normalized,
          textHash: hashTextV2(normalized),
          renderPolicy: input.renderPolicy ?? "durable_render",
          sourcePolicy: input.sourcePolicy ?? "durable_render"
        }
      ]
    : [];

  return {
    id: `copy_${hashTextV2(`${input.slotId}:${input.text}`).slice(0, 16)}`,
    artifactVersion: "copy-artifact-v2",
    producerId: input.producerId ?? localBusinessCopyProducerV2.id,
    producerVersion: input.producerVersion ?? localBusinessCopyProducerV2.version,
    verticalPlaybookVersion: input.verticalPlaybookVersion,
    sectionContractVersion: input.sectionContractVersion,
    slotId: input.slotId,
    text: input.text,
    claimSpans,
    status: input.status ?? "selected"
  };
}

export function hashTextV2(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeClaimTextV2(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.,;:!?'"()\[\]{}]+|[.,;:!?'"()\[\]{}]+$/g, "")
    .toLowerCase();
}

function claimIdV2(input: {
  sourceFactIds: string[];
  category: ClaimCategoryV2;
  normalizedClaimValue: string;
}) {
  const payload = JSON.stringify({
    sourceFactIds: [...input.sourceFactIds].sort(),
    category: input.category,
    normalizedClaimValue: normalizeClaimTextV2(input.normalizedClaimValue)
  });
  return `claim_${createHash("sha256").update(payload).digest("hex").slice(0, 32)}`;
}
