"use client";

import Link from "next/link";
import { useRole, useUser } from "./auth/use-auth";
import { PlusIcon } from "./icons";

/* Entry point to the existing contributor dashboard (/contribute). Visible
   only to contributors, admins and owners — visibility is UX only; the
   /contribute route itself remains gated server-side by requireRole(). */
export default function AddSummaryButton({
  lang,
  label,
}: {
  lang: string;
  label: string;
}) {
  const { user } = useUser();
  const { role } = useRole(user?.id ?? null);

  const canAdd =
    role === "contributor" || role === "admin" || role === "owner";
  if (!canAdd) return null;

  return (
    <Link href={`/${lang}/contribute`} className="btn-primary">
      <PlusIcon className="h-4 w-4" />
      {label}
    </Link>
  );
}
