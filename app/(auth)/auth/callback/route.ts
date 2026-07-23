import { NextResponse, type NextRequest } from "next/server";
import { configuredAppOrigin } from "@/lib/app-origin";
import { requestOrigin } from "@/lib/host-routing";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const authNextCookieName = "lodesta_auth_next";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next")) ?? safeNextPath(decodeCookieValue(request.cookies.get(authNextCookieName)?.value)) ?? "/account";
  if (code) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  const response = NextResponse.redirect(new URL(next, configuredAppOrigin() ?? requestOrigin(request.headers)));
  response.cookies.set(authNextCookieName, "", { path: "/auth", maxAge: 0 });
  return response;
}

function safeNextPath(value: string | undefined | null) { return value?.startsWith("/") && !value.startsWith("//") ? value : undefined; }
function decodeCookieValue(value: string | undefined) { if (!value) return undefined; try { return decodeURIComponent(value); } catch { return undefined; } }
