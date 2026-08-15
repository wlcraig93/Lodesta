import { NextResponse } from "next/server";
import { sitePlatformRepository } from "@/packages/platform-data";
import { getCurrentUser } from "./supabase/server";
import { adminToken, authRequired, hasPlatformAdminRole, hasValidAdminToken } from "./auth-policy";

export async function requireAdmin(request: Request) {
  const expected = adminToken();
  if (expected && hasValidAdminToken(request.headers)) return null;
  if (!expected && !authRequired() && ["GET", "HEAD"].includes(request.method.toUpperCase())) return null;

  const auth = await getCurrentUser();
  if (auth.configured && hasPlatformAdminRole(auth.user)) return null;

  return NextResponse.json({ error: "Admin authorization required" }, { status: 401 });
}

export async function requireAdminOrSiteOwner(request: Request, siteId: string) {
  const expected = adminToken();
  if (expected && hasValidAdminToken(request.headers)) return null;
  if (!expected && !authRequired() && ["GET", "HEAD"].includes(request.method.toUpperCase())) return null;

  const auth = await getCurrentUser();
  if (auth.configured && hasPlatformAdminRole(auth.user)) {
    return null;
  }

  const userId = auth.user?.id;
  if (!auth.configured || !userId) {
    return NextResponse.json({ error: "Site owner authorization required" }, { status: 401 });
  }

  const site = await sitePlatformRepository.getSite(siteId);
  if (site?.ownerUserId === userId) return null;
  return NextResponse.json({ error: "Site owner authorization required" }, { status: 403 });
}

export async function requireSiteOwner(siteId: string) {
  const auth = await getCurrentUser();
  const userId = auth.user?.id;
  if (!auth.configured || !userId) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Site owner authorization required" }, { status: 401 })
    };
  }
  const site = await sitePlatformRepository.getSite(siteId);
  if (site?.ownerUserId !== userId) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Site owner authorization required" }, { status: 403 })
    };
  }
  return { ok: true as const, actorId: userId };
}
