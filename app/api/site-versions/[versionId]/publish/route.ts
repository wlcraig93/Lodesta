import { NextResponse } from "next/server";
import { sitePlatformRepository } from "@/packages/platform-data";
import { siteAuthoringWorkflow, deriveSitePublicationReadiness } from "@/packages/site-platform";
import { authorizedSiteActor } from "@/app/api/site-agent/auth";

export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const version = await sitePlatformRepository.getSiteVersion(versionId);
  if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  const actor = await authorizedSiteActor(request, version.siteId);
  if (!actor.ok) return actor.response;
  try {
    const readiness = await deriveSitePublicationReadiness({ versionId, repository: sitePlatformRepository });
    if (readiness.status !== "ready") return NextResponse.json({ error: "Candidate is not ready to publish", readiness }, { status: 422 });
    const promoted = await siteAuthoringWorkflow.promoteVersion(versionId, actor.actorId);
    return NextResponse.json({ ok: true, version: promoted });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message.includes("stale") ? 409 : 422 });
  }
}
