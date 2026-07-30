import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";
import { prospectImportSchema } from "@/packages/prospect-research";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const parsed = prospectImportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid prospect import", issues: parsed.error.issues }, { status: 400 });
  }
  return NextResponse.json(await repository.importProspectResearch(parsed.data.records));
}
