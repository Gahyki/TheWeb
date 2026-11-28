import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabasePublishableKey, supabaseUrl } from "./config";

export { isSupabaseConfigured };

let client: SupabaseClient | undefined;

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
  // A link with tokens in its URL must not sign this browser in.
  client ??= createClient(supabaseUrl, supabasePublishableKey, {
    auth: { detectSessionInUrl: false },
  });
  return client;
}
