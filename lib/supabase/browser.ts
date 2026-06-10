"use client";

import { createBrowserClient } from "@supabase/ssr";

export type SupabaseBrowserConfig = {
  url: string;
  anonKey: string;
};

export function createSupabaseBrowserClient(config?: SupabaseBrowserConfig) {
  const url = config?.url || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = config?.anonKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required for browser auth.");
  }

  return createBrowserClient(url, anonKey);
}
