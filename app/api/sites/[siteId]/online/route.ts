import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSiteOwner } from "@/lib/security";
import { sitePlatformRepository } from "@/packages/platform-data";

const bodySchema = z.object({ online: z.boolean() }).strict();

/** Takes the owner's published site offline, or puts the same version back online. */
export async function POST(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const actor = await requireSiteOwner(siteId);
  if (!actor.ok) return actor.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose whether the site should be online." }, { status: 400 });
  try {
    await sitePlatformRepository.setSiteOnline(siteId, actor.actorId, parsed.data.online);
    const site = await sitePlatformRepository.getSite(siteId);
    return NextResponse.json({ ok: true, status: site?.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("site_not_published")) {
      return NextResponse.json({ error: "This site hasn't been published yet." }, { status: 409 });
    }
    if (message.includes("published_version_unavailable")) {
      return NextResponse.json({ error: "The last published version is no longer available. Publish a new version to go back online." }, { status: 409 });
    }
    console.error(JSON.stringify({ event: "site_online_change_failed", siteId, message }));
    return NextResponse.json({ error: "We couldn't change your site right now. Try again in a minute." }, { status: 503 });
  }
}
