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
    const run = await siteAuthoringWorkflow.restoreVersion(versionId, actor.actorId);
    return NextResponse.json({ run }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
