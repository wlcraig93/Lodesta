import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";
import { getCurrentUser } from "@/lib/supabase/server";

const claimSchema = z.object({
  siteId: z.string().min(1),
  ownerEmail: z.string().email().optional(),
  verifiedFacts: z.array(z.string()).optional(),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: "Content rights and hosting terms must be accepted." })
  }),
  acceptedManagement: z.literal(true, {
    errorMap: () => ({ message: "Managed-site authority must be accepted." })
  })
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = claimSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid claim request", issues: parsed.error.issues }, { status: 400 });
  }

  const auth = await getCurrentUser();
  const ownerUserId = auth.user?.id;
  const ownerEmail = (parsed.data.ownerEmail ?? auth.user?.email)?.toLowerCase();

  if (!ownerEmail) {
    return NextResponse.json({ error: "Owner email is required to claim a site." }, { status: 400 });
  }

  const claim = await repository.createClaim({ ...parsed.data, ownerUserId, ownerEmail });
  if (!claim) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  return NextResponse.json(claim);
}

export async function GET(request: Request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  return NextResponse.json({ claims: await repository.listClaims(searchParams.get("siteId") ?? undefined) });
}
