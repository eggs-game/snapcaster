import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase = null;

export function isSupabaseConfigured() {
  return Boolean(URL && KEY);
}

export function getSupabase() {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured for this deployment.");
  }
  if (!supabase) {
    supabase = createClient(URL, KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return supabase;
}
