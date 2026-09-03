import { createHash } from "node:crypto";
import type { SitePublicBuildInput } from "@/packages/site-contracts";
import type {
  WebsiteAssessment,
  WebsiteAssessmentTargetKind
} from "./contracts";

export function assessmentReferenceAuthorityFor(
  buildInput: SitePublicBuildInput | undefined
): WebsiteAssessment["referenceAuthority"] {
  const authority = buildInput
    ? {
        kind: "site_public_build_input" as const,
        publicBuildInputId: buildInput.id,
        publicBuildInputHash: buildInput.inputHash,
        businessRevision: buildInput.ownerOperationalRevision,
        siteIntentRevision: buildInput.ownerIntentRevision,
        sourceSnapshotIds: [...buildInput.sourceSnapshotIds].sort()
      }
    : {
        kind: "none" as const,
        sourceSnapshotIds: []
      };
  return {
    ...authority,
    identity: contentIdentity("reference-authority", authority) as `reference-authority@sha256:${string}`
  };
}

export function assessmentServingContractFor(input: {
  targetKind: WebsiteAssessmentTargetKind;
  sourceUrl?: string;
}): WebsiteAssessment["servingContract"] {
  const kind = input.targetKind === "site_artifact"
    ? "retained_artifact" as const
    : input.sourceUrl && isPrivatePreviewUrl(input.sourceUrl)
      ? "private_preview" as const
      : "anonymous_public" as const;
  return {
    kind,
    identity: contentIdentity("serving-contract", { kind }) as `serving-contract@sha256:${string}`
  };
}

export function assessmentInventoryIdentity(
  inventory: WebsiteAssessment["siteInventory"]
) {
  return contentIdentity("assessment-inventory", {
    source: inventory.source,
    coverage: inventory.coverage,
    eligiblePages: inventory.eligiblePages,
    assessedPages: inventory.assessedPages,
    pageTypes: inventory.pageTypes.map(({ id, count }) => ({ id, count }))
  }) as `assessment-inventory@sha256:${string}`;
}

function isPrivatePreviewUrl(value: string) {
  try {
    return /^\/preview(?:\/|$)/.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

function contentIdentity(name: string, value: unknown) {
  return `${name}@sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
