import { NextResponse } from "next/server";
import { hasValidAdminToken } from "@/lib/auth-policy";
import {
  auditOpenAiRuntimeSettingsRejection,
  getOpenAiRuntimeSettings,
  saveOpenAiRuntimeSettings,
  StaleOperatorSettingsError,
  validateOpenAiRuntimeSettingsUpdateInput
} from "@/lib/operator-settings";
import { requireAdmin } from "@/lib/security";
import { getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

const staleMessage = "Settings changed since this page loaded. Reload and apply your changes again.";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  return NextResponse.json(await getOpenAiRuntimeSettings({ bypassCache: true }));
}

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const changedBy = await operatorActor(request);
  const body = await request.json().catch(() => undefined);
  const parsed = validateOpenAiRuntimeSettingsUpdateInput(body);
  if (!parsed.ok) {
    await auditOpenAiRuntimeSettingsRejection({
      changedBy,
      attemptedValue: body,
      error: parsed.issues.join("; ")
    }).catch((error) => console.warn(`Unable to audit rejected OpenAI settings save: ${error instanceof Error ? error.message : String(error)}`));
    return NextResponse.json({ error: "Invalid OpenAI runtime settings", issues: parsed.issues }, { status: 400 });
  }

  try {
    const snapshot = await saveOpenAiRuntimeSettings({
      settings: parsed.settings,
      expectedVersion: parsed.version,
      changedBy
    });
    return NextResponse.json(snapshot);
  } catch (error) {
    if (error instanceof StaleOperatorSettingsError) {
      return NextResponse.json({ error: staleMessage }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save OpenAI runtime settings" },
      { status: 500 }
    );
  }
}

async function operatorActor(request: Request) {
  if (hasValidAdminToken(request.headers)) return "admin_token";
  const auth = await getCurrentUser();
  return auth.user?.id ? `supabase_user:${auth.user.id}` : "local_admin";
}
