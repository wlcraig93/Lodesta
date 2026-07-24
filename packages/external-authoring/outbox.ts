import { sitePlatformRepository } from "@/packages/platform-data";
import { enqueueSiteArtifactAssessment } from "@/packages/website-assessment/service";
import { externalAuthoringRepository, type ExternalAuthoringRepository } from "./repository";

export async function processNextAuthoringOutbox(input: {
  workerId?: string;
  repository?: ExternalAuthoringRepository;
} = {}) {
  const repository = input.repository ?? externalAuthoringRepository;
  const workerId = input.workerId ?? `authoring-outbox-${process.pid}`;
  const event = await repository.claimOutbox(workerId);
  if (!event) return null;
  try {
    const artifact = await sitePlatformRepository.getBuildArtifact(event.payload.artifactId);
    if (!artifact || artifact.siteId !== event.payload.siteId) throw new Error("Finalized artifact is unavailable.");
    await enqueueSiteArtifactAssessment({
      artifact,
      versionId: event.payload.candidateVersionId
    });
    await repository.completeOutbox(event.id, new Date().toISOString());
    return { eventId: event.id, status: "completed" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await repository.failOutbox(event.id, message, new Date(Date.now() + 30_000).toISOString());
    return { eventId: event.id, status: "failed" as const, error: message };
  }
}
