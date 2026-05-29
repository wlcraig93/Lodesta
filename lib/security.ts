import { NextResponse } from "next/server";
import { repository } from "./repository";
import { getCurrentUser } from "./supabase/server";
import { adminToken, authRequired, hasValidAdminToken } from "./auth-policy";

export function requireAdmin(request: Request) {
  const expected = adminToken();
  if (!expected) {
    if (authRequired()) return NextResponse.json({ error: "Admin authorization required" }, { status: 401 });
    return null;
  }

  if (hasValidAdminToken(request.headers)) return null;
  return NextResponse.json({ error: "Admin authorization required" }, { status: 401 });
}

export async function requireAdminOrSiteOwner(request: Request, siteId: string) {
  const expected = adminToken();
  if (expected && hasValidAdminToken(request.headers)) return null;

  if (!expected && !authRequired()) return null;

  const auth = await getCurrentUser();
  const userId = auth.user?.id;
  const email = auth.user?.email?.toLowerCase();
  if (!auth.configured || (!userId && !email)) {
    return NextResponse.json({ error: "Site owner authorization required" }, { status: 401 });
  }

  const claims = await repository.listClaims(siteId);
  const ownsSite = claims.some(
    (claim) =>
      claim.status === "claimed" &&
      ((userId && claim.ownerUserId === userId) || (email && claim.ownerEmail?.toLowerCase() === email))
  );
  if (ownsSite) return null;
  return NextResponse.json({ error: "Site owner authorization required" }, { status: 403 });
}
