import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database-types";

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing Supabase environment variable: ${name}. Add it to .env.local.`
    );
  }
  return value;
}

/* Anonymous, cookie-free Supabase client for GENUINELY PUBLIC reads only.

   Unlike createClient() (lib/auth/supabase-server.ts), this client never reads
   cookies(), so it does NOT opt routes into dynamic rendering. Use it ONLY for
   public, anon-accessible data (active subject/summary/exam metadata) so those
   routes can be statically rendered / ISR-cached.

   It carries the anon key (public by design) and respects RLS, so it can only
   read rows the public policy allows. NEVER use it for authenticated or
   private queries — those must go through createClient() + the SECURITY
   DEFINER functions. */
export function createAnonClient() {
  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createSupabaseClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
