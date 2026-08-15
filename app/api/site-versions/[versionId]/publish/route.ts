import { NextResponse } from "next/server";
import { sitePlatformRepository } from "@/packages/platform-data";
import { siteAuthoringWorkflow } from "@/packages/site-platform/workflow";
import { requireSiteOwner } from "@/lib/security";

export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const version = await sitePlatformRepository.getSiteVersion(versionId);
  if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  void request;
  const actor = await requireSiteOwner(version.siteId);
  if (!actor.ok) return actor.response;
  try {
    const promoted = await siteAuthoringWorkflow.promoteVersion(versionId, actor.actorId);
    return NextResponse.json({ ok: true, version: promoted });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const candidateChanged = message.includes("version_not_promotable")
      || message.includes("candidate_changed");
    const ownerAuthorityChanged = message.includes("owner_authority_changed");
    const storageUnavailable = message.includes("candidate_release_storage_unavailable")
      || message.includes("candidate_verification_unavailable");
    return NextResponse.json(
      {
        error: candidateChanged
          ? "A newer candidate is available. Review it before publishing."
          : ownerAuthorityChanged
            ? "Business details or site preferences changed after this version."
            : storageUnavailable
              ? "Candidate storage could not be verified right now. Nothing was published; try again shortly."
              : message,
        code: candidateChanged
          ? "candidate_changed"
          : ownerAuthorityChanged
            ? "owner_authority_changed"
            : storageUnavailable
              ? "candidate_storage_unavailable"
              : "candidate_integrity_failed"
      },
      { status: storageUnavailable ? 503 : candidateChanged || ownerAuthorityChanged ? 409 : 422 }
    );
  }
}
