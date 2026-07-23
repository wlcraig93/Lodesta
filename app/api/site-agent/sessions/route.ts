import { NextResponse } from "next/server";
import { z } from "zod";
import { sitePlatformRepository } from "@/packages/platform-data";
import { ownerSiteAgentRun, siteAuthoringWorkflow } from "@/packages/site-platform";
import { deriveSitePublicationReadiness } from "@/packages/site-platform";
import { authorizedSiteActor } from "../auth";

const sessionSchema = z.object({ siteId: z.string().min(1) }).strict();

export async function GET(request: Request) {
  const siteId = new URL(request.url).searchParams.get("siteId");
  if (!siteId) return NextResponse.json({ error: "siteId is required" }, { status: 400 });
  const actor = await authorizedSiteActor(request, siteId);
  if (!actor.ok) return actor.response;
  return NextResponse.json(await workspacePayload(siteId, actor.actorId));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = sessionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid session request", issues: parsed.error.issues }, { status: 400 });
  const actor = await authorizedSiteActor(request, parsed.data.siteId);
  if (!actor.ok) return actor.response;
  try {
    await siteAuthoringWorkflow.getOrCreateSession({ siteId: parsed.data.siteId, ownerId: actor.actorId });
    return NextResponse.json(await workspacePayload(parsed.data.siteId, actor.actorId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}

async function workspacePayload(siteId: string, actorId: string) {
  const site = await sitePlatformRepository.getSite(siteId);
  if (!site) return { site: null };
  const session = await sitePlatformRepository.getActiveAgentSession(siteId, actorId);
  const [input, versions, messages, runs] = await Promise.all([
    site.currentPublicBuildInputId ? sitePlatformRepository.getPublicBuildInput(site.currentPublicBuildInputId) : undefined,
    sitePlatformRepository.listSiteVersions(siteId),
    session ? sitePlatformRepository.listAgentMessages(session.id) : [],
    session ? sitePlatformRepository.listAgentRuns(session.id) : []
  ]);
  const artifacts = await Promise.all(versions.map((version) => sitePlatformRepository.getBuildArtifact(version.artifactId)));
  const activeRun = runs.find((run) => run.status === "queued" || run.status === "running");
  const activeEvents = activeRun ? await sitePlatformRepository.listAgentRunEvents(activeRun.id, { limit: 500 }) : [];
  const candidate = versions.find((version) => version.status === "candidate");
  const readiness = candidate ? await deriveSitePublicationReadiness({ versionId: candidate.id, repository: sitePlatformRepository }) : undefined;
  const versionRoutes = Object.fromEntries(versions.map((version, index) => [
    version.id,
    artifacts[index]?.routes.map((route) => ({ path: route.path, title: route.title })) ?? []
  ]));
  return {
    site,
    session,
    input,
    versions,
    versionRoutes,
    messages,
    runs: runs.map(ownerSiteAgentRun),
    readiness,
    openFindings: [],
    activeRunActivity: activeEvents.at(-1)?.name
  };
}
