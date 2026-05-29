import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { runSiteQa } from "@/lib/qa";
import { requireAdminOrSiteOwner } from "@/lib/security";

const qaSchema = z.object({
  siteId: z.string().min(1).optional(),
  versionStatus: z.enum(["draft", "published"]).default("published")
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = qaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid QA request", issues: parsed.error.issues }, { status: 400 });
  }

  const siteId = parsed.data.siteId ?? "site_joes_pizza";
  const unauthorized = await requireAdminOrSiteOwner(request, siteId);
  if (unauthorized) return unauthorized;
  const bundle = await repository.getSiteBundle(siteId);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  return NextResponse.json(runSiteQa(bundle, { versionStatus: parsed.data.versionStatus }));
}
