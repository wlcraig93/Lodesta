export function getSupabasePublicEnv() {
  const url = envValue("NEXT_PUBLIC_SUPABASE_URL") || envValue("SUPABASE_URL");
  const anonKey = envValue("NEXT_PUBLIC_SUPABASE_ANON_KEY") || envValue("SUPABASE_ANON_KEY");
  return {
    url,
    anonKey,
    configured: Boolean(url && anonKey)
  };
}

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}
