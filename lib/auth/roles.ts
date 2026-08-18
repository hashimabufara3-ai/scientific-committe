/* Role model and the explicit role-transition allowlist.

   The four roles form a single committee hierarchy:

       student < contributor < admin < owner

   Numeric rank is used ONLY for coarse access gates (e.g. "which routes may
   this user open"). It is deliberately NOT used to decide who may modify whom:
   role changes go through the explicit canAssign() allowlist below, which
   mirrors the SQL inside supabase/migrations/20260815090003_rbac_functions_policies.sql.
   Keep the two in sync — the SQL function is the authoritative enforcement. */

export const ROLES = ["student", "contributor", "admin", "owner"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_RANK: Record<Role, number> = {
  student: 0,
  contributor: 1,
  admin: 2,
  owner: 3,
};

export function isRole(value: unknown): value is Role {
  return (
    typeof value === "string" &&
    (ROLES as readonly string[]).includes(value)
  );
}

/* Coarse access-gate helpers (routes, dashboard visibility). */
export function isAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export const isContributorOrAbove = (role: Role): boolean =>
  isAtLeast(role, "contributor");

export const isAdminOrAbove = (role: Role): boolean =>
  isAtLeast(role, "admin");

/* Explicit transition allowlist.

   Allowed transitions:
     student        <-> contributor            by admin or owner
     student/contributor -> admin              by owner
     admin          -> student/contributor     by owner
     -> owner                                   NEVER through role management
     any change to the owner row                NEVER through role management
     no-op (same role)                          NEVER
     self-change                                NEVER

   Returns false for anything not explicitly listed. */
export function canAssign(
  actor: Role,
  targetRole: Role,
  newRole: Role
): boolean {
  if (newRole === "owner" || targetRole === "owner") return false;
  if (newRole === targetRole) return false;

  switch (actor) {
    case "owner":
      if (targetRole === "admin") {
        return newRole === "student" || newRole === "contributor";
      }
      if (targetRole === "student" || targetRole === "contributor") {
        return (
          newRole === "student" ||
          newRole === "contributor" ||
          newRole === "admin"
        );
      }
      return false;
    case "admin":
      return (
        (targetRole === "student" || targetRole === "contributor") &&
        (newRole === "student" || newRole === "contributor")
      );
    default:
      return false;
  }
}
