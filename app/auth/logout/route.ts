import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export async function POST(request: Request) {
  const env = getSupabasePublicEnv();
  if (env.configured) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }

  return NextResponse.redirect(new URL("/auth/login", request.url));
}
