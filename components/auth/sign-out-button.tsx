"use client";

import { useRouter } from "next/navigation";

export function SignOutButton({
  lang,
  label,
  className = "",
}: {
  lang: string;
  label: string;
  className?: string;
}) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          const { createClient } = await import("../../lib/auth/supabase-browser");
          const supabase = createClient();
          await supabase.auth.signOut();
        } catch {
          // Session may be missing or Supabase unconfigured; still navigate home.
        }
        router.push(`/${lang}`);
        router.refresh();
      }}
      className={`btn-ghost !px-4 !py-2 disabled:opacity-40 ${className}`}
    >
      {label}
    </button>
  );
}
