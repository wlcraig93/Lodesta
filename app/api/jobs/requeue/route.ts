import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

const requeueSchema = z.object({
  jobId: z.string().min(1)
});

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const parsed = requeueSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid requeue request", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await repository.requeueJob(parsed.data.jobId);
  return result.ok ? NextResponse.json(result) : NextResponse.json(result, { status: 404 });
}
