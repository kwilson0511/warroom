import { createClient } from "@supabase/supabase-js";

// Server-side Supabase client.
// Uses the SERVICE ROLE key, which bypasses Row Level Security.
// This file must ONLY ever be imported by server code:
//   - API routes (app/api/**)
//   - the daily refresh script
// NEVER import it into a "use client" component. The service role
// key is a secret; if it reaches the browser, anyone can read/write
// your whole database.

export function getServerClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables."
    );
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}
