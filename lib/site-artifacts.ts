import { createHash } from "node:crypto";
import type { SiteArtifactRecord } from "./models";

export function copyCandidateArtifactToSite(input: {
  artifact: SiteArtifactRecord;
  managedSiteId: string;
  acceptedAt?: string;
}): SiteArtifactRecord {
  const acceptedAt = input.acceptedAt ?? new Date().toISOString();
  return {
    ...input.artifact,
    id: `artifact_${input.managedSiteId}_${hashId(input.artifact.id)}`,
    siteCandidateId: undefined,
    siteId: input.managedSiteId,
    scope: "site_selected",
    createdAt: acceptedAt
  };
}

function hashId(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}
