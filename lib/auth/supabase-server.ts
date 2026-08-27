import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database-types";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing Supabase environment variable: ${name}. Add it to .env.local.`
    );
  }
  return value;
}

/* Server-side Supabase client for Server Components, Server Actions and Route
   Handlers. Uses async cookies() as required by Next.js 16. Create a fresh
   client per request — never cache or reuse it across requests. Env variables
   are read lazily so modules can be imported before configuration exists. */
export async function createClient() {
  const supabaseUrl = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component where cookies cannot be set.
        }
      },
    },
  });
}

/* Admin client with service-role key. Bypasses RLS — use ONLY for trusted
   server-side operations (auth user creation, privileged updates).
   NEVER expose this client to browser code or return its results in
   server-action responses. */
export function createAdminClient() {
  const supabaseUrl = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createSupabaseClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
