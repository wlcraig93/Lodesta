import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";
import {
  parseProspectCandidateQuery,
  upsertProspectSchema
} from "@/packages/prospect-research";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const parsed = parseProspectCandidateQuery(new URL(request.url).searchParams, { defaultToPending: true });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid prospect filters", issues: parsed.error.issues }, { status: 400 });
  }
  const [prospects, total] = await Promise.all([
    repository.listProspectCandidates(parsed.data),
    repository.countProspectCandidates(parsed.data)
  ]);
  return NextResponse.json({ prospects, total, limit: parsed.data.limit, offset: parsed.data.offset });
}

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const parsed = upsertProspectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid prospect", issues: parsed.error.issues }, { status: 400 });
  }
  return NextResponse.json(await repository.upsertProspect(parsed.data));
}
