import type { SiteBundle, SiteVersionV3 } from "./models";
import type { LodestaRepository } from "./repository";
import { publicSiteVersionV3Issue } from "./site-version-v3";

export async function loadPublicSiteVersion(
  repository: Pick<LodestaRepository, "getGenerationInputSnapshot">,
  bundle: SiteBundle
): Promise<{ version: SiteVersionV3; snapshot: NonNullable<Awaited<ReturnType<LodestaRepository["getGenerationInputSnapshot"]>>> } | null> {
  const version = bundle.siteModel.versions.find((candidate): candidate is SiteVersionV3 => candidate.status === "published" && candidate.rendererVersion === "layout-v3");
  if (!version || publicSiteVersionV3Issue(version)) return null;
  const snapshot = await repository.getGenerationInputSnapshot(version.inputSnapshotId);
  if (!snapshot || snapshot.eligibilityMode !== "public") return null;
  return { version, snapshot };
}
