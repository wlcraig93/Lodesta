import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import type { PlatformSiteRecord } from "@/packages/site-contracts";
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

export async function requirePlatformSiteOwnerAccess(site: PlatformSiteRecord, nextPath: string) {
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
  if (!userId) redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);

  const ownsSite = site.ownerUserId === userId;
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
