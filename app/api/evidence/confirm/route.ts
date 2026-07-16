import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";
import { getCurrentUser } from "@/lib/supabase/server";

const schema = z.object({
  siteId: z.string().min(1),
  evidenceId: z.string().min(1),
  decision: z.enum(["confirmed", "rejected"])
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid evidence decision." }, { status: 400 });
  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;
  const auth = await getCurrentUser();
  const result = await repository.confirmSiteEvidence({
    ...parsed.data,
    decidedBy: auth.user?.id ?? auth.user?.email ?? "authenticated_operator"
  });
  if (!result) return NextResponse.json({ error: "Site or canonical evidence ledger was not found." }, { status: 404 });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });
  return NextResponse.json({ ok: true, evidence: result.item });
}
