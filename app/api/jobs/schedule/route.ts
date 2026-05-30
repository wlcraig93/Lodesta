import { NextResponse } from "next/server";
import { z } from "zod";
import { scheduleLaunchJobs } from "@/lib/job-scheduler";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

const scheduleSchema = z.object({
  task: z.enum(["monthly_action_lists", "analytics_retention", "launch_maintenance"]).default("launch_maintenance"),
  siteIds: z.array(z.string().min(1)).optional(),
  retentionDays: z.number().int().min(30).max(3650).optional(),
  scheduleKey: z.string().min(1).optional(),
  runAfter: z.string().datetime().optional()
});

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => ({}));
  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid schedule request", issues: parsed.error.issues }, { status: 400 });
  }

  return NextResponse.json(await scheduleLaunchJobs(repository, parsed.data));
}
