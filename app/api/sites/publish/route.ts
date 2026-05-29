import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { runSiteQa } from "@/lib/qa";
import { requireAdminOrSiteOwner } from "@/lib/security";
import { claimGateForBundle } from "@/lib/site-publication";

const publishSchema = z.object({
  siteId: z.string().min(1),
  confirmed: z.boolean().default(false)
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid publish request", issues: parsed.error.issues }, { status: 400 });
  }
  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;
  if (!parsed.data.confirmed) {
    return NextResponse.json(
      { error: "Publish confirmation required.", confirmationRequired: true },
      { status: 409 }
    );
  }

  const bundle = await repository.getSiteBundle(parsed.data.siteId);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  const claimGate = claimGateForBundle(bundle, await repository.listClaims(parsed.data.siteId));
  if (!claimGate.ok) {
    const verificationRequired = claimGate.code === "verification_required";
    return NextResponse.json(
      {
        error: claimGate.reason,
        claimGate: claimGate.code,
        paymentRequired: !verificationRequired,
        factVerificationRequired: verificationRequired,
        missingRequiredFacts: claimGate.missingFacts
      },
      { status: verificationRequired ? 409 : 402 }
    );
  }
  const qa = runSiteQa(bundle, { versionStatus: "draft" });
  if (!qa.passed) {
    return NextResponse.json({ error: "Draft QA failed. Fix blocking checks before publishing.", qa }, { status: 400 });
  }
  const result = await repository.publishDraft(parsed.data.siteId);
  if (!result) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });
  return NextResponse.json({ ...result, qa, confirmed: true });
}
