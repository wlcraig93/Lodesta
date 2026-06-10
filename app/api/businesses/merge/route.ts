import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

const mergeBusinessesSchema = z.object({
  sourceBusinessId: z.string().min(1),
  targetBusinessId: z.string().min(1)
});

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => ({}));
  const parsed = mergeBusinessesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid business merge request", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await repository.mergeBusinesses(parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });
  return NextResponse.json(result);
}
