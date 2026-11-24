import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url: string = import.meta.env.VITE_SUPABASE_URL || "";
const publishableKey: string = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

let client: SupabaseClient | undefined;

/** True when the build carries Supabase credentials. Auth UI should not render without them. */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && publishableKey);
}

/**
 * Browser Supabase client, created on first use so builds without credentials
 * still load. Uses the publishable key only; data access is governed by RLS.
 */
export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  client ??= createClient(url, publishableKey);
  return client;
}
