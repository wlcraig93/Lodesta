import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { platformOperationsRepository } from "@/packages/platform-operations";
import { getCurrentUser } from "./supabase/server";
import { authRequired, hasValidAdminToken, isAdminUserId } from "./auth-policy";

export async function requireOwnerAccess(nextPath: string) {
  const auth = await getCurrentUser();
  if (!auth.configured && authRequired()) {
    redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
  }
  if (auth.configured && !auth.user) {
    redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
  }
  return auth;
}

export async function requireAdminPageAccess(nextPath: string) {
  if (hasValidAdminToken(await headers())) {
    return { configured: true as const, user: null, admin: true as const };
  }

  const auth = await getCurrentUser();
  if (!auth.configured && authRequired()) {
    redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
  }
  if (!auth.configured) return { ...auth, admin: true as const };
  if (!auth.user) redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
  if (!isAdminUserId(auth.user.id)) notFound();
  return { ...auth, admin: true as const };
}

export async function requirePlatformSiteOwnerAccess(siteId: string, nextPath: string) {
  if (hasValidAdminToken(await headers())) {
    return { configured: true as const, user: null, admin: true as const };
  }

  const auth = await requireOwnerAccess(nextPath);
  if (!auth.configured) return auth;
  const userId = auth.user?.id;
  const email = auth.user?.email?.toLowerCase();
  if (!userId && !email) redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
  if (isAdminUserId(userId)) return { ...auth, admin: true as const };

  const claims = await platformOperationsRepository.listClaims(siteId);
  const ownsSite = claims.some(
    (claim) =>
      claim.status === "claimed" &&
      ((userId && claim.ownerUserId === userId) || (email && claim.ownerEmail?.toLowerCase() === email))
  );
  if (!ownsSite) notFound();
  return auth;
}
