import { createHash } from "node:crypto";
import type { GenerationArtifactV2 } from "./models";

export function promoteGenerationArtifactV2(input: {
  artifact: GenerationArtifactV2;
  managedSiteId: string;
  promotedAt?: string;
}): GenerationArtifactV2 {
  const promotedAt = input.promotedAt ?? new Date().toISOString();
  return {
    ...input.artifact,
    id: `artifact_${input.managedSiteId}_${hashId(input.artifact.id)}`,
    generationId: undefined,
    siteId: input.managedSiteId,
    scope: "managed_site_selected",
    createdAt: promotedAt
  };
}

function hashId(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}
