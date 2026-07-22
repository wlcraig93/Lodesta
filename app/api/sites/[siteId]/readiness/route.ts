import { NextResponse } from "next/server";
import { authorizedSiteActor } from "@/app/api/site-agent/auth";
import { sitePlatformRepository } from "@/packages/platform-data";
import { deriveSitePublicationReadiness } from "@/packages/site-platform";

export async function GET(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const actor = await authorizedSiteActor(request, siteId);
  if (!actor.ok) return actor.response;
  const versionId = new URL(request.url).searchParams.get("versionId");
  const versions = await sitePlatformRepository.listSiteVersions(siteId);
  const version = versionId ? versions.find((candidate) => candidate.id === versionId) : versions.find((candidate) => candidate.status === "candidate");
  if (!version) return NextResponse.json({ error: "Candidate version not found" }, { status: 404 });
  return NextResponse.json(await deriveSitePublicationReadiness({ versionId: version.id, repository: sitePlatformRepository }));
}
