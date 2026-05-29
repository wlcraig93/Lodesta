import { NextResponse } from "next/server";
import { repository } from "./repository";
import { getCurrentUser } from "./supabase/server";

export function requireAdmin(request: Request) {
  const expected = process.env.LODESTA_ADMIN_TOKEN;
  if (!expected) return null;

  if (hasValidAdminToken(request, expected)) return null;
  return NextResponse.json({ error: "Admin authorization required" }, { status: 401 });
}

export async function requireAdminOrSiteOwner(request: Request, siteId: string) {
  const expected = process.env.LODESTA_ADMIN_TOKEN;
  if (!expected) return null;

  if (hasValidAdminToken(request, expected)) return null;

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

function hasValidAdminToken(request: Request, expected: string) {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const headerToken = request.headers.get("x-lodesta-admin-token");
  const provided = bearer ?? headerToken;

  return Boolean(provided && timingSafeEqual(provided, expected));
}

function timingSafeEqual(a: string, b: string) {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }
  return mismatch === 0;
}
