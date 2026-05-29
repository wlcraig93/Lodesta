import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

const campaignSchema = z.object({
  name: z.string().min(1),
  channel: z.enum(["direct_mail", "email", "phone", "manual"]).default("direct_mail"),
  status: z.enum(["draft", "running", "paused", "completed"]).default("draft"),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional()
});

export async function GET(request: Request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;
  return NextResponse.json({ campaigns: await repository.listOutboundCampaigns() });
}

export async function POST(request: Request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null);
  const parsed = campaignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid outbound campaign request", issues: parsed.error.issues }, { status: 400 });
  }
  return NextResponse.json(await repository.createOutboundCampaign(parsed.data));
}
