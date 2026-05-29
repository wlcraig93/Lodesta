import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "./env";

export async function createSupabaseServerClient() {
  const env = getSupabasePublicEnv();
  if (!env.url || !env.anonKey) {
    throw new Error("SUPABASE_URL/SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY are required for auth.");
  }

  const cookieStore = await cookies();

  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server components cannot always write cookies; route handlers can.
        }
      }
    }
  });
}

export async function getCurrentUser() {
  const env = getSupabasePublicEnv();
  if (!env.configured) return { configured: false as const, user: null };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return { configured: true as const, user: null };
  return { configured: true as const, user: data.user };
}
