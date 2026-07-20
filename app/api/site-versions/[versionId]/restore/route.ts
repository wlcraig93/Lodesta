import { after, NextResponse } from "next/server";
import { sitePlatformRepository } from "@/packages/platform-data";
import { agenticSiteWorkflow } from "@/packages/site-platform";
import { authorizedSiteActor } from "@/app/api/site-agent/auth";

export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const version = await sitePlatformRepository.getSiteVersion(versionId);
  if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  const actor = await authorizedSiteActor(request, version.siteId);
  if (!actor.ok) return actor.response;
  try {
    const run = await agenticSiteWorkflow.restoreVersion(versionId, actor.actorId);
    after(async () => { await agenticSiteWorkflow.executeRunAndFinalize(run.id); });
    return NextResponse.json({ run }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
