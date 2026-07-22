import { NextResponse, type NextRequest } from "next/server";
import { configuredAppOrigin } from "@/lib/app-origin";
import { requestOrigin } from "@/lib/host-routing";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const authNextCookieName = "lodesta_auth_next";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  let next =
    safeNextPath(url.searchParams.get("next")) ??
    safeNextPath(decodeCookieValue(request.cookies.get(authNextCookieName)?.value)) ??
    "/account";
  if (code) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  const response = NextResponse.redirect(new URL(next, callbackRedirectOrigin(request)));
  response.cookies.set(authNextCookieName, "", { path: "/auth", maxAge: 0 });
  return response;
}

function safeNextPath(value: string | undefined | null) {
  if (!value?.startsWith("/") || value.startsWith("//")) return undefined;
  return value;
}

function decodeCookieValue(value: string | undefined) {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function callbackRedirectOrigin(request: NextRequest) {
  const configuredOrigin = configuredAppOrigin();
  if (configuredOrigin) return configuredOrigin;
  return requestOrigin(request.headers);
}
