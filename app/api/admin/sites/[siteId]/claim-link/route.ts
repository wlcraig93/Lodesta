import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { appOriginFromRequest } from "@/lib/app-origin";
import { requireAdmin } from "@/lib/security";
import { sha256 } from "@/packages/business-data";
import { platformOperationsRepository } from "@/packages/platform-operations";

const claimLinkLifetimeMs = 14 * 24 * 60 * 60_000;

/** Creates a claim link for an unowned prospect project. The token is shown once and stored only as a hash. */
export async function POST(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const { siteId } = await params;
  const token = randomBytes(32).toString("base64url");
  try {
    const invitation = await platformOperationsRepository.createSiteClaimLink({
      siteId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + claimLinkLifetimeMs).toISOString()
    });
    return NextResponse.json({ url: `${appOriginFromRequest(request)}/adopt/${token}`, expiresAt: invitation.expiresAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("site_not_claimable")) return NextResponse.json({ error: "Only an unowned project can get a claim link." }, { status: 409 });
    if (message.includes("site_not_found")) return NextResponse.json({ error: "Site not found." }, { status: 404 });
    throw error;
  }
}

/** Revokes every open claim link for the site. */
export async function DELETE(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const { siteId } = await params;
  return NextResponse.json({ revoked: await platformOperationsRepository.revokeSiteClaimLinks(siteId) });
}
