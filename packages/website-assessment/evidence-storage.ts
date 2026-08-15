import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "@/packages/business-data";
import { configuredArtifactBlobStore, type ArtifactBlobStore } from "@/packages/site-artifacts";
import { websiteAssessmentSchema, type WebsiteAssessment } from "./contracts";

export async function persistWebsiteAssessmentEvidence(input: {
  assessment: WebsiteAssessment;
  store?: ArtifactBlobStore;
}) {
  const assessment = structuredClone(input.assessment);
  const store = input.store ?? configuredArtifactBlobStore();
  const stored = new Map<string, { key: string; contentHash: `sha256:${string}` }>();
  let unavailable = 0;
  const evidenceGroups = assessment.dimensions
    .flatMap((dimension) => dimension.criteria)
    .map((evidenceGroup) => ({
      evidenceGroup,
      visual: evidenceGroup.evaluatorType === "model"
        && evidenceGroup.topics.includes("visual_quality")
    }));
  let unavailableVisual = 0;
  for (const { evidenceGroup, visual } of evidenceGroups) {
    for (const item of evidenceGroup.evidence) {
      const localPath = item.artifactKey;
      if (!localPath || !isLocalRenderPath(localPath)) continue;
      const existing = stored.get(localPath);
      if (existing) {
        item.artifactKey = existing.key;
        item.contentHash = existing.contentHash;
        continue;
      }
      try {
        const bytes = await readFile(resolve(process.cwd(), localPath));
        const contentHash = sha256(bytes);
        const key = `website-assessments/${assessment.id}/evidence/${contentHash.slice("sha256:".length)}.png`;
        await store.putImmutable({
          key,
          bytes,
          contentType: "image/png",
          contentHash
        });
        stored.set(localPath, { key, contentHash });
        item.artifactKey = key;
        item.contentHash = contentHash;
      } catch {
        unavailable += 1;
        if (visual) unavailableVisual += 1;
        delete item.artifactKey;
      }
    }
  }
  if (unavailable) {
    assessment.coverage.limitations.push(`${unavailable} local screenshot reference${unavailable === 1 ? " was" : "s were"} unavailable for immutable delivery.`);
    assessment.coverage.limitations = [...new Set(assessment.coverage.limitations)];
    assessment.coverage.pipelineCompleteness = Math.min(
      assessment.coverage.pipelineCompleteness,
      0.9999
    );
    assessment.coverage.comparisonEligible = false;
  }
  if (unavailableVisual) {
    assessment.coverage.limitations.push(
      `${unavailableVisual} cited Visual Quality screenshot${unavailableVisual === 1 ? " was" : "s were"} unavailable for immutable delivery.`
    );
    assessment.coverage.limitations = [...new Set(assessment.coverage.limitations)];
  }
  return websiteAssessmentSchema.parse(assessment);
}
function isLocalRenderPath(value: string) {
  const normalized = value.replaceAll("\\", "/");
  return normalized.startsWith(".data/render-inspections/") && normalized.endsWith(".png") && !normalized.includes("..");
}
