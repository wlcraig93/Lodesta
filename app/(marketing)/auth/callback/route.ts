import { NextResponse } from "next/server";
import { requestOrigin } from "@/lib/host-routing";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next");
  const next = nextParam?.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/account";

  if (code) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(next, callbackRedirectOrigin(request)));
}

function callbackRedirectOrigin(request: Request) {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL;
  if (configuredOrigin) {
    try {
      return new URL(configuredOrigin).origin;
    } catch {
      // Fall back to forwarded request headers when the configured URL is malformed.
    }
  }
  return requestOrigin(request.headers);
}
