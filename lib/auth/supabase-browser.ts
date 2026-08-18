import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database-types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variable. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local."
  );
}

/* Browser Supabase client for client-side auth interactions. Uses only the
   public anon key — never a service_role key. NEXT_PUBLIC_* variables are
   inlined into the client bundle at build time, so they must be accessed
   statically (a dynamic `process.env[name]` lookup is not inlined). */
export function createClient() {
  return createBrowserClient<Database>(supabaseUrl!, supabaseAnonKey!);
}
