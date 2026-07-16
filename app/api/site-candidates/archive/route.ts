import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

const archiveSchema = z.object({
  candidateIds: z.array(z.string().min(1)).min(1).max(100)
});

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null);
  const parsed = archiveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid archive request", issues: parsed.error.issues }, { status: 400 });
  }
  const archived = await repository.archiveSiteCandidates(parsed.data.candidateIds);
  return NextResponse.json({ archivedCount: archived.length, archived });
}
