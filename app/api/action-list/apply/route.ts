import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { runSiteQa } from "@/lib/qa";
import { requireAdminOrSiteOwner } from "@/lib/security";

const applySchema = z.object({
  siteId: z.string().min(1),
  findingId: z.string().min(1),
  mode: z.enum(["draft", "publish_after_qa"]).default("draft")
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = applySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid apply request", issues: parsed.error.issues }, { status: 400 });
  }
  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;

  const result = await repository.applyFindingToDraft(parsed.data);
  if (!result) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });

  const bundle = await repository.getSiteBundle(parsed.data.siteId);
  const qa = bundle ? runSiteQa(bundle, { versionStatus: "draft" }) : null;
  if (parsed.data.mode === "publish_after_qa") {
    if (!qa?.passed) return NextResponse.json({ ...result, qa, published: false });
    const publish = await repository.publishDraft(parsed.data.siteId);
    return NextResponse.json({ ...result, qa, published: Boolean(publish?.ok), publish });
  }

  return NextResponse.json({ ...result, qa });
}
