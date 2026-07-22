import { requireAdmin, requireAdminOrSiteOwner } from "@/lib/security";
import { authRequired, hasPlatformAdminRole, hasValidAdminToken } from "@/lib/auth-policy";
import { getCurrentUser } from "@/lib/supabase/server";

export async function authorizedSiteActor(request: Request, siteId: string) {
  const unauthorized = await requireAdminOrSiteOwner(request, siteId);
  if (unauthorized) return { ok: false as const, response: unauthorized };
  const auth = await getCurrentUser();
  return {
    ok: true as const,
    actorId: auth.user?.id ?? "authorized_operator",
    isOperator: hasValidAdminToken(request.headers) || hasPlatformAdminRole(auth.user) || (!auth.configured && !authRequired())
  };
}

export function canAccessAgentSession(actor: { actorId: string; isOperator: boolean }, sessionOwnerId: string) {
  return actor.isOperator || actor.actorId === sessionOwnerId;
}

export async function authorizedOperator(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return { ok: false as const, response: unauthorized };
  const auth = await getCurrentUser();
  return { ok: true as const, actorId: auth.user?.id ?? "authorized_operator" };
}
