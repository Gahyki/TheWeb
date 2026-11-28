/// <reference types="vite/client" />
// For the node test project too, which type-checks this via store.ts.

/**
 * Build-time Supabase settings. Kept apart from supabase.ts so eager code
 * can check them without pulling supabase-js into the bundle. Node (the
 * store tests) has no import.meta.env.
 */
export const supabaseUrl: string = import.meta.env?.VITE_SUPABASE_URL ?? "";
export const supabasePublishableKey: string = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

let configured = Boolean(supabaseUrl && supabasePublishableKey);

/** True when the build carries Supabase credentials. Auth UI should not render without them. */
export function isSupabaseConfigured(): boolean {
  return configured;
}

/** Tests only: stands in for a build with or without the credentials. */
export function setSupabaseConfiguredForTests(value: boolean): void {
  configured = value;
}
