import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedAdminClient: SupabaseClient | null = null;

export function getSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when LODESTA_REPOSITORY=supabase.");
  }

  cachedAdminClient ??= createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  return cachedAdminClient;
}
