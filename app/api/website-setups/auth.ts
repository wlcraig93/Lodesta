import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { platformOperationsRepository } from "@/packages/platform-operations";

export async function requireWebsiteSetupUser() {
  const auth = await getCurrentUser();
  if (!auth.configured) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Website setup requires configured authentication.", code: "setup_auth_not_configured" }, { status: 503 })
    };
  }
  if (!auth.user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Authentication required.", code: "authentication_required" }, { status: 401 })
    };
  }
  return { ok: true as const, user: auth.user };
}

export async function requireOwnedWebsiteSetup(setupId: string) {
  const auth = await requireWebsiteSetupUser();
  if (!auth.ok) return auth;
  const setup = await platformOperationsRepository.getWebsiteSetup(setupId);
  if (!setup || setup.ownerUserId !== auth.user.id) {
    return { ok: false as const, response: NextResponse.json({ error: "Website setup not found." }, { status: 404 }) };
  }
  return { ok: true as const, user: auth.user, setup };
}
