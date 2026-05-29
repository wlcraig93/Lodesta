import { NextResponse } from "next/server";
import { z } from "zod";
import { crawlUrl } from "@/lib/crawler";
import { createPresenceIntakePlan } from "@/lib/presence-intake";
import { requireAdmin } from "@/lib/security";

const presenceSchema = z.object({
  url: z.string().url()
});

export async function POST(request: Request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const parsed = presenceSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid presence assessment request", issues: parsed.error.issues }, { status: 400 });
  }

  const crawl = await crawlUrl(parsed.data.url);
  return NextResponse.json(createPresenceIntakePlan(parsed.data.url, crawl));
}
