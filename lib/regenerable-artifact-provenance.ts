import { createHash } from "node:crypto";
import type { RegenerableArtifactProvenanceV1 } from "./models";

export function createRegenerableArtifactProvenanceV1(input: {
  producerId: string;
  producerVersion: string;
  modelId?: string;
  createdAt?: string;
  inputs?: Record<string, unknown>;
  stale?: boolean;
  staleReason?: string;
}): RegenerableArtifactProvenanceV1 {
  return {
    version: "regenerable-artifact-provenance-v1",
    producerId: input.producerId,
    producerVersion: input.producerVersion,
    modelId: input.modelId ?? "deterministic",
    createdAt: input.createdAt ?? new Date().toISOString(),
    inputHashes: hashInputs(input.inputs ?? {}),
    stale: input.stale ?? false,
    ...(input.staleReason ? { staleReason: input.staleReason } : {})
  };
}

export function markRegenerableArtifactProvenanceStaleV1(
  provenance: RegenerableArtifactProvenanceV1 | undefined,
  reason: string
): RegenerableArtifactProvenanceV1 | undefined {
  return provenance
    ? {
        ...provenance,
        stale: true,
        staleReason: reason
      }
    : undefined;
}

function hashInputs(inputs: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(inputs)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, hashStable(value)])
  );
}

function hashStable(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}
