import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { platformOperationsRepository } from "@/packages/platform-operations";
import { getCurrentUser } from "./supabase/server";
import { authRequired, hasPlatformAdminRole, hasValidAdminToken } from "./auth-policy";

export type OwnerWorkspaceAccessMode = "owner" | "platform_admin_preview" | "local_open";

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
    return { configured: true as const, user: null, canAccessAdmin: true as const, tokenAccess: true as const };
  }

  const auth = await getCurrentUser();
  if (!auth.configured && authRequired()) {
    redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
  }
  if (!auth.configured) return { ...auth, canAccessAdmin: true as const, tokenAccess: false as const };
  if (!auth.user) redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
  if (!hasPlatformAdminRole(auth.user)) notFound();
  return { ...auth, canAccessAdmin: true as const, tokenAccess: false as const };
}

export async function requirePlatformSiteOwnerAccess(siteId: string, nextPath: string) {
  if (hasValidAdminToken(await headers())) {
    return {
      configured: true as const,
      user: null,
      mode: "platform_admin_preview" as const,
      canAccessAdmin: true as const,
      tokenAccess: true as const
    };
  }

  const auth = await requireOwnerAccess(nextPath);
  if (!auth.configured) {
    return {
      ...auth,
      mode: "local_open" as const,
      canAccessAdmin: true as const,
      tokenAccess: false as const
    };
  }
  const userId = auth.user?.id;
  const email = auth.user?.email?.toLowerCase();
  if (!userId && !email) redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);

  const claims = await platformOperationsRepository.listClaims(siteId);
  const ownsSite = claims.some(
    (claim) =>
      claim.status === "claimed" &&
      ((userId && claim.ownerUserId === userId) || (email && claim.ownerEmail?.toLowerCase() === email))
  );
  const canAccessAdmin = hasPlatformAdminRole(auth.user);
  if (ownsSite) {
    return { ...auth, mode: "owner" as const, canAccessAdmin, tokenAccess: false as const };
  }
  if (canAccessAdmin) {
    return {
      ...auth,
      mode: "platform_admin_preview" as const,
      canAccessAdmin: true as const,
      tokenAccess: false as const
    };
  }
  notFound();
}
