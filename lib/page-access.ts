import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import type { SiteBundle } from "./models";
import { repository } from "./repository";
import { getCurrentUser } from "./supabase/server";
import { authRequired, hasValidAdminToken, isAdminEmail } from "./auth-policy";

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
  if (!isAdminEmail(auth.user.email)) notFound();
  return { ...auth, admin: true as const };
}

export async function requireSiteOwnerAccess(bundle: SiteBundle, nextPath: string) {
  const auth = await requireOwnerAccess(nextPath);
  if (!auth.configured) return auth;
  const userId = auth.user?.id;
  const email = auth.user?.email?.toLowerCase();
  if (!userId && !email) redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);

  const claims = await repository.listClaims(bundle.businessProfile.siteId);
  const ownsSite = claims.some(
    (claim) =>
      claim.status === "claimed" &&
      ((userId && claim.ownerUserId === userId) || (email && claim.ownerEmail?.toLowerCase() === email))
  );
  if (!ownsSite) notFound();
  return auth;
}
