import { notFound, redirect } from "next/navigation";
import type { SiteBundle } from "./models";
import { repository } from "./repository";
import { getCurrentUser } from "./supabase/server";

export async function requireOwnerAccess(nextPath: string) {
  const auth = await getCurrentUser();
  if (auth.configured && !auth.user) {
    redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
  }
  return auth;
}

export async function requireSiteOwnerAccess(bundle: SiteBundle, nextPath: string) {
  const auth = await requireOwnerAccess(nextPath);
  if (!auth.configured) return auth;
  const email = auth.user?.email?.toLowerCase();
  if (!email) redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);

  const claims = await repository.listClaims(bundle.businessProfile.siteId);
  const ownsSite = claims.some((claim) => claim.ownerEmail?.toLowerCase() === email);
  if (!ownsSite) notFound();
  return auth;
}
