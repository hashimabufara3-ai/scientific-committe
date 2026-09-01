"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDictionary } from "../dictionaries";
import { getSessionRole } from "../../../lib/auth/authorize";
import { canAssign, isRole, type Role } from "../../../lib/auth/roles";
import {
  createAdminClient,
  createClient,
} from "../../../lib/auth/supabase-server";
import { checkRateLimit, LIMITERS } from "../../../lib/security/rate-limit";
import { captureActionError } from "../../../lib/security/sentry";

/* Admin mutations.

   Every mutation re-reads the actor's role from the database and re-checks the
   explicit transition allowlist immediately before hitting the database RPC.
   The SECURITY DEFINER functions in the database remain the authoritative
   second layer — a caller can never bypass these checks through the client. */

export type AdminErrorKey =
  | "notAllowed"
  | "notFound"
  | "roleUnchanged"
  | "ownerLocked"
  | "selfChange"
  | "confirmMismatch"
  | "transferOnlyOwner"
  | "transferSelf"
  | "transferNotFound"
  | "deleteSelf"
  | "deleteOwner"
  | "deleteAdmin"
  | "generic";

export type AdminActionResult = {
  ok: boolean;
  errorKey?: AdminErrorKey;
};

function readLang(formData: FormData): string {
  const lang = formData.get("lang");
  return typeof lang === "string" ? lang : "en";
}

/* Map PostgREST-surfaced SQL exception messages back to localized error keys.
   The server-side allowlist check above should catch everything first; this is
   a defensive mapping for anything the database rejects. */
function mapRpcError(message: string): AdminErrorKey {
  const m = message.toLowerCase();
  if (m.includes("owner account")) return "deleteOwner";
  if (m.includes("another admin")) return "deleteAdmin";
  if (m.includes("your own account")) return "deleteSelf";
  if (m.includes("owner")) return "ownerLocked";
  if (m.includes("unchanged")) return "roleUnchanged";
  if (m.includes("own role")) return "selfChange";
  if (m.includes("not exist")) return "notFound";
  if (m.includes("transfer")) return "transferOnlyOwner";
  if (m.includes("not allowed") || m.includes("insufficient"))
    return "notAllowed";
  return "generic";
}

/* Shared admin actor gate. Re-reads the authoritative session from the
   database (getSessionRole: getUser + role + must_change_password in one
   round trip), redirects unauthenticated users to sign-in, and — because
   Server Actions now skip the proxy's Supabase layers — redirects any profile
   flagged for a forced password change to the change-password page, mirroring
   the proxy's navigation rule. Role is still never trusted from the client and
   the SECURITY DEFINER RPCs remain the authoritative second layer. */
async function requireAdminActor(lang: string) {
  const session = await getSessionRole();
  if (!session) redirect(`/${lang}/auth/sign-in`);
  if (session.mustChangePassword) redirect(`/${lang}/auth/change-password`);
  return session;
}

/* Change a member's role through assign_role(). */
export async function setRoleAction(
  _prev: AdminActionResult,
  formData: FormData
): Promise<AdminActionResult> {
  const lang = readLang(formData);
  const targetId = String(formData.get("targetId") ?? "");
  const newRoleRaw = String(formData.get("newRole") ?? "");

  const session = await requireAdminActor(lang);
  if (!isRole(newRoleRaw)) return { ok: false, errorKey: "notAllowed" };
  const newRole = newRoleRaw as Role;

  /* Rate limit: 30 requests / minute per authenticated admin */
  const { success: allowed } = await checkRateLimit(
    LIMITERS.adminAction,
    session.user.id
  );
  if (!allowed) return { ok: false, errorKey: "notAllowed" };

  if (session.role !== "admin" && session.role !== "owner") {
    return { ok: false, errorKey: "notAllowed" };
  }
  if (targetId === session.user.id) {
    return { ok: false, errorKey: "selfChange" };
  }

  const supabase = await createClient();
  // Target data comes from the same server-authorized admin_list_members()
  // RPC the dashboard uses. It returns only id/full_name/role/created_at —
  // never email — and is only callable by admin/owner (auth.uid()-derived).
  const { data: members, error: membersError } = await supabase.rpc(
    "admin_list_members"
  );
  if (membersError) {
    captureActionError(membersError, "admin_list_members RPC failed", {
      action: "setRoleAction",
      route: `/${lang}/admin`,
      code: membersError.code,
    });
  }
  const target = (members ?? []).find((member) => member.id === targetId);

  if (!target || !isRole(target.role)) {
    return { ok: false, errorKey: "notFound" };
  }
  if (target.role === newRole) {
    return { ok: false, errorKey: "roleUnchanged" };
  }
  if (!canAssign(session.role, target.role, newRole)) {
    return {
      ok: false,
      errorKey: target.role === "owner" ? "ownerLocked" : "notAllowed",
    };
  }

  const { error } = await supabase.rpc("assign_role", {
    target: targetId,
    new_role: newRole,
  });
  if (error) return { ok: false, errorKey: mapRpcError(error.message) };

  revalidatePath(`/${lang}/admin`);
  return { ok: true };
}

/* Transfer ownership. The typed confirmation is validated server-side too, so
   a forged request cannot skip the explicit-confirmation step. */
export async function transferOwnershipAction(
  _prev: AdminActionResult,
  formData: FormData
): Promise<AdminActionResult> {
  const lang = readLang(formData);
  const targetId = String(formData.get("targetId") ?? "");
  const confirmName = String(formData.get("confirmName") ?? "").trim();

  const session = await requireAdminActor(lang);
  if (session.role !== "owner") {
    return { ok: false, errorKey: "transferOnlyOwner" };
  }

  /* Rate limit: 30 requests / minute per authenticated owner */
  const { success: allowed } = await checkRateLimit(
    LIMITERS.adminAction,
    session.user.id
  );
  if (!allowed) return { ok: false, errorKey: "notAllowed" };

  if (targetId === session.user.id) {
    return { ok: false, errorKey: "transferSelf" };
  }

  const supabase = await createClient();
  const { data: members, error: membersError } = await supabase.rpc(
    "admin_list_members"
  );
  if (membersError) {
    captureActionError(membersError, "admin_list_members RPC failed", {
      action: "transferOwnershipAction",
      route: `/${lang}/admin`,
      code: membersError.code,
    });
  }
  const target = (members ?? []).find((member) => member.id === targetId);
  if (!target) {
    return { ok: false, errorKey: "transferNotFound" };
  }
  const dict = await getDictionary(lang);
  const targetName = target.full_name || dict.adminPage.unnamed;
  if (
    confirmName.length === 0 ||
    confirmName.localeCompare(targetName, undefined, {
      sensitivity: "accent",
    }) !== 0
  ) {
    return { ok: false, errorKey: "confirmMismatch" };
  }

  const { error } = await supabase.rpc("transfer_ownership", {
    target: targetId,
  });
  if (error) return { ok: false, errorKey: mapRpcError(error.message) };

  revalidatePath(`/${lang}/admin`);
  return { ok: true };
}

/* Delete a website account.

   A website account is a Supabase Auth user (with a 1:1 profiles row that
   cascades on delete). Deleting it requires the Admin API, so this action:
     1. Re-reads the actor's role from the database and re-checks admin/owner.
     2. Rate-limits.
     3. Calls the SECURITY DEFINER admin_delete_user() RPC, which is the
        AUTHORITATIVE authorization gate (it enforces every target rule and is
        not bypassable by calling the RPC directly — it raises otherwise).
     4. If the target account is linked to a committee member, deletes that
        committee record FIRST via the existing authorized
        admin_delete_committee_member() RPC (which re-runs require_admin_role()
        and renumbers the survivors to a dense 1..N sort_order). This happens
        BEFORE the Auth delete so that a successful account deletion can never
        leave a visible stale committee member in About Us. If this cleanup
        fails, the account deletion is aborted (no partial success).
     5. Only after the linked-member cleanup, deletes the Auth user via the
        secure service-role client. The service-role key is never exposed to
        the client. This cascade-deletes the profile.
     6. Logs an audit event (best-effort; target info captured before delete).
     7. Revalidates the admin page. */
export async function deleteAccountAction(
  _prev: AdminActionResult,
  formData: FormData
): Promise<AdminActionResult> {
  const lang = readLang(formData);
  const targetId = String(formData.get("targetId") ?? "");

  const session = await requireAdminActor(lang);
  if (session.role !== "admin" && session.role !== "owner") {
    return { ok: false, errorKey: "notAllowed" };
  }

  /* Rate limit: 30 requests / minute per authenticated admin */
  const { success: allowed } = await checkRateLimit(
    LIMITERS.adminAction,
    session.user.id
  );
  if (!allowed) return { ok: false, errorKey: "notAllowed" };

  const supabase = await createClient();

  /* Target info for the audit log, captured from the same server-authorized
     admin_list_members() RPC the dashboard uses, BEFORE deletion. */
  const { data: members, error: membersError } = await supabase.rpc(
    "admin_list_members"
  );
  if (membersError) {
    captureActionError(membersError, "admin_list_members RPC failed", {
      action: "deleteAccountAction",
      route: `/${lang}/admin`,
      code: membersError.code,
    });
  }
  const target = (members ?? []).find((member) => member.id === targetId);

  /* Authoritative authorization: admin_delete_user() enforces owner
     protection, no self-delete, and the admin-vs-admin rule, raising on any
     unauthorized request. It performs no deletion itself. */
  const { error } = await supabase.rpc("admin_delete_user", {
    p_user_id: targetId,
  });
  if (error) return { ok: false, errorKey: mapRpcError(error.message) };

  /* Resolve and delete any committee member linked to this account BEFORE
     deleting the Auth user. admin_list_committee_members() is the authorized
     SECURITY DEFINER listing (admin/owner only) that returns user_id for ALL
     members (active and inactive) — a direct RLS select would hide inactive
     members. Resolution is keyed strictly on `user_id = targetId`, and the
     unique partial index guarantees at most one committee member per account,
     so we can never touch an unrelated member. Deletion reuses the existing
     admin_delete_committee_member() RPC, which re-runs require_admin_role()
     and renumbers survivors to a dense 1..N sort_order.

     If the resolution or the cleanup fails at any point, abort the whole
     account deletion (fail-closed) so we never report success while an
     account that should be removed still has a linked committee member. */
  const { data: committeeMembers, error: committeeListError } = await supabase.rpc(
    "admin_list_committee_members"
  );
  if (committeeListError) {
    captureActionError(
      committeeListError,
      "admin_list_committee_members RPC failed",
      {
        action: "deleteAccountAction",
        route: `/${lang}/admin`,
        code: committeeListError.code,
      }
    );
    return { ok: false, errorKey: "generic" };
  }
  const linkedCommitteeMember = (committeeMembers ?? []).find(
    (member) => member.user_id === targetId
  );
  if (linkedCommitteeMember) {
    const { error: memberDeleteError } = await supabase.rpc(
      "admin_delete_committee_member",
      { p_id: linkedCommitteeMember.id }
    );
    if (memberDeleteError) {
      captureActionError(
        memberDeleteError,
        "admin_delete_committee_member failed during account deletion",
        {
          action: "deleteAccountAction",
          route: `/${lang}/admin`,
          code: memberDeleteError.code,
        }
      );
      return { ok: false, errorKey: "generic" };
    }
  }

  /* Now that authorization succeeded and any linked committee member has been
     removed, delete the actual Auth user with the service-role client
     (server-side only). */
  const adminSupabase = createAdminClient();
  const { error: deleteError } =
    await adminSupabase.auth.admin.deleteUser(targetId);
  if (deleteError) {
    captureActionError(deleteError, "auth.admin.deleteUser failed", {
      action: "deleteAccountAction",
      route: `/${lang}/admin`,
      code: deleteError.code,
    });
    return { ok: false, errorKey: "generic" };
  }

  /* Best-effort audit log. Credentials are never logged. */
  await supabase.rpc("log_audit_event", {
    p_action: "account_deleted",
    p_target_type: "profile",
    p_target_id: targetId,
    p_details: {
      username: target?.username ?? null,
      full_name: target?.full_name ?? null,
      role: target?.role ?? null,
      committee_member_id: linkedCommitteeMember?.id ?? null,
      committee_member_deleted: linkedCommitteeMember ? true : null,
    } as Record<string, unknown>,
  });

  revalidatePath(`/${lang}/admin`);
  if (linkedCommitteeMember) revalidatePath(`/${lang}/about`);
  return { ok: true };
}

/* =========================================================================
   Committee Members CRUD
   ========================================================================= */

export type CommitteeMemberErrorKey =
  | "notAllowed"
  | "notFound"
  | "validation"
  | "duplicateUser"
  | "generic";

export type CommitteeMemberActionResult = {
  ok: boolean;
  errorKey?: CommitteeMemberErrorKey;
  id?: string;
};

function mapCommitteeRpcError(message: string): CommitteeMemberErrorKey {
  const m = message.toLowerCase();
  if (m.includes("not allowed") || m.includes("insufficient"))
    return "notAllowed";
  if (m.includes("not found")) return "notFound";
  if (m.includes("duplicate") || m.includes("unique") || m.includes("already"))
    return "duplicateUser";
  if (
    m.includes("required") ||
    m.includes("must be") ||
    m.includes("check")
  )
    return "validation";
  return "generic";
}

/* Create a new committee member. */
export async function createCommitteeMemberAction(
  _prev: CommitteeMemberActionResult,
  formData: FormData
): Promise<CommitteeMemberActionResult> {
  const lang = readLang(formData);

  const session = await requireAdminActor(lang);
  if (session.role !== "admin" && session.role !== "owner") {
    return { ok: false, errorKey: "notAllowed" };
  }

  /* Rate limit: 30 requests / minute per authenticated admin */
  const { success: allowed } = await checkRateLimit(
    LIMITERS.adminAction,
    session.user.id
  );
  if (!allowed) return { ok: false, errorKey: "notAllowed" };

  const supabase = await createClient();
  const userIdRaw = String(formData.get("userId") ?? "").trim();
  const { error } = await supabase.rpc(
    "admin_create_committee_member",
    {
      p_user_id: userIdRaw || null,
      p_name_ar: String(formData.get("nameAr") ?? ""),
      p_name_en: String(formData.get("nameEn") ?? ""),
      p_major_ar: String(formData.get("majorAr") ?? ""),
      p_major_en: String(formData.get("majorEn") ?? ""),
      p_role_ar: String(formData.get("roleAr") ?? ""),
      p_role_en: String(formData.get("roleEn") ?? ""),
      p_gender: String(formData.get("gender") ?? "") as "male" | "female",
      p_sort_order: Number(formData.get("sortOrder") ?? 0),
      p_is_active: formData.get("isActive") === "on",
    }
  );
  if (error) {
    return { ok: false, errorKey: mapCommitteeRpcError(error.message) };
  }

  revalidatePath(`/${lang}/admin`);
  revalidatePath(`/${lang}/about`);
  return { ok: true };
}

/* =========================================================================
   Committee Member + Account Creation
   ========================================================================= */

export type CommitteeMemberWithAccountErrorKey =
  | CommitteeMemberErrorKey
  | "accountCreationFailed"
  | "duplicateEmail";

export type CommitteeMemberWithAccountActionResult = {
  ok: boolean;
  errorKey?: CommitteeMemberWithAccountErrorKey;
  id?: string;
  credentials?: {
    email: string;
    username: string;
    temporaryPassword: string;
  };
};

/* Generate a cryptographically strong random password: 16 chars,
   uppercase + lowercase + digits. Not derived from name or any
   predictable value. */
function generateTemporaryPassword(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/* Replicate the slug_username() SQL function logic in TypeScript.
   Generates a deterministic ASCII-safe slug from a name.
   Used to predict the username that handle_new_user() will create.
   Must stay in sync with supabase/migrations/*_slug_dot_and_resolve_email.sql */
function slugUsername(name: string): string {
  let v = name.trim().toLowerCase();
  if (!v) return "member";

  v = v.replace(/\s+/g, ".");
  v = v.replace(/[^a-z0-9._]/g, "");
  v = v.replace(/[._]{2,}/g, ".");
  v = v.replace(/^[._]+|[._]+$/g, "");

  const core = v.replace(/[._]/g, "");
  if (!core || core.length < 3) return "member";

  if (v.length > 15) {
    v = v.slice(0, 15);
    v = v.replace(/[._]+$/, "");
  }

  return v;
}

/* Create a new committee member WITH a website account.
   This action:
   1. Creates a Supabase Auth user (via Admin API, email_confirm: true)
   2. The handle_new_user() trigger creates the profile (role defaults to
      student)
   3. Assigns the requested account role via assign_role() — the authoritative
      SECURITY DEFINER gate that re-checks the actor's role from the database
      and enforces the transition allowlist (admin may only make
      student/contributor; owner may also make admin; owner is never
      assignable). The role chooser is UX only; this call is authoritative.
   4. Sets must_change_password = true
   5. Creates the committee member record (linked to the new user)
   6. Logs the audit event
   7. Returns credentials ONCE (never stored in DB)

   Compensation: If any step after auth user creation fails, the auth
   user is deleted to prevent orphaned accounts. */
export async function createCommitteeMemberWithAccountAction(
  _prev: CommitteeMemberWithAccountActionResult,
  formData: FormData
): Promise<CommitteeMemberWithAccountActionResult> {
  const lang = readLang(formData);

  const session = await requireAdminActor(lang);
  if (session.role !== "admin" && session.role !== "owner") {
    return { ok: false, errorKey: "notAllowed" };
  }

  /* Rate limit: 30 requests / minute per authenticated admin */
  const { success: allowed } = await checkRateLimit(
    LIMITERS.adminAction,
    session.user.id
  );
  if (!allowed) return { ok: false, errorKey: "notAllowed" };

  const nameEn = String(formData.get("nameEn") ?? "").trim();
  const nameAr = String(formData.get("nameAr") ?? "").trim();
  const majorAr = String(formData.get("majorAr") ?? "");
  const majorEn = String(formData.get("majorEn") ?? "");
  const roleAr = String(formData.get("roleAr") ?? "");
  const roleEn = String(formData.get("roleEn") ?? "");
  const gender = String(formData.get("gender") ?? "") as "male" | "female";
  const sortOrder = Number(formData.get("sortOrder") ?? 0);
  const isActive = formData.get("isActive") === "on";
  /* Account role for the new user, chosen from the role chooser in the form.
     Defaults to student (the profiles.role column default). Only
     student/contributor/admin are valid; assign_role() below is the
     authoritative check that re-validates against the actor's role. */
  const accountRoleRaw = String(formData.get("accountRole") ?? "").trim();
  const accountRole =
    accountRoleRaw === "contributor" || accountRoleRaw === "admin"
      ? accountRoleRaw
      : "student";

  /* Validate required fields (same checks as admin_create_committee_member) */
  if (!nameAr) return { ok: false, errorKey: "validation" };
  if (!nameEn) return { ok: false, errorKey: "validation" };
  if (!majorAr) return { ok: false, errorKey: "validation" };
  if (!majorEn) return { ok: false, errorKey: "validation" };
  if (!roleAr) return { ok: false, errorKey: "validation" };
  if (!roleEn) return { ok: false, errorKey: "validation" };
  if (gender !== "male" && gender !== "female")
    return { ok: false, errorKey: "validation" };

  /* Generate deterministic username and email.
     The username will be created by handle_new_user() trigger; we predict
     it here for the email and to return to the admin. The trigger handles
     collisions deterministically. */
  const baseSlug = slugUsername(nameEn);
  const predictedEmail = `${baseSlug}@ptuksc.com`;
  const temporaryPassword = generateTemporaryPassword();
const supabase = await createClient();
  const adminSupabase = createAdminClient();
  let authUserId: string | null = null;

  try {
    /* Step 1: Create auth user via Admin API.
       email_confirm: true → no confirmation email sent.
       handle_new_user() trigger creates the profiles row. */
    const { data: authUser, error: authError } =
      await adminSupabase.auth.admin.createUser({
        email: predictedEmail,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: {
          full_name: nameEn,
        },
      });

    if (authError || !authUser?.user) {
      captureActionError(
        authError ?? new Error("createUser returned no user"),
        "admin.createUser failed",
        {
          action: "createCommitteeMemberWithAccountAction",
          route: `/${lang}/admin`,
          code: authError?.code,
        }
      );
      return { ok: false, errorKey: "accountCreationFailed" };
    }

    authUserId = authUser.user.id;

    /* Step 1b: Read back the ACTUAL username and email assigned by the
       database trigger. The trigger may have chosen a different username
       if a collision occurred (e.g. hashim.abufara → hashim.abufara.2).
       Never return predicted credentials — always the actual ones. */
    const { data: actualProfile, error: profileReadError } =
      await adminSupabase
        .from("profiles")
        .select("username, email")
        .eq("id", authUserId)
        .single();

    if (
      profileReadError ||
      !actualProfile?.username ||
      !actualProfile.email
    ) {
      captureActionError(
        profileReadError ?? new Error("profile read-back empty"),
        "admin.createUser profile read-back failed",
        {
          action: "createCommitteeMemberWithAccountAction",
          route: `/${lang}/admin`,
          code: profileReadError?.code,
        }
      );
      await adminSupabase.auth.admin.deleteUser(authUserId);
      return { ok: false, errorKey: "accountCreationFailed" };
    }

    const actualUsername = actualProfile.username;
    const actualEmail: string = actualProfile.email;

    /* Step 2: Assign the requested account role via assign_role().
       The handle_new_user() trigger created the profile with role defaulting
       to 'student'. When a contributor/admin role was requested, assign_role()
       re-checks the actor's role from the database and enforces the explicit
       transition allowlist (admin -> student/contributor only; owner ->
       student/contributor/admin; owner is never assignable). This keeps the
       server authorization authoritative — the UI role chooser is UX only.
       Students need no call (the default is already 'student'). */
    if (accountRole !== "student") {
      const { error: roleError } = await supabase.rpc("assign_role", {
        target: authUserId,
        new_role: accountRole,
      });
      if (roleError) {
        captureActionError(roleError, "assign_role failed during account creation", {
          action: "createCommitteeMemberWithAccountAction",
          route: `/${lang}/admin`,
          code: roleError.code,
        });
        /* Compensating: delete the auth user we just created. */
        await adminSupabase.auth.admin.deleteUser(authUserId);
        return { ok: false, errorKey: "generic" };
      }
    }

    /* Step 3: Set must_change_password on the new profile.
       The trigger already created the profile row. */
    const { error: mcpError } = await supabase.rpc(
      "set_must_change_password",
      {
        p_user_id: authUserId,
        p_must_change: true,
      }
    );

    if (mcpError) {
      captureActionError(mcpError, "set_must_change_password failed", {
        action: "createCommitteeMemberWithAccountAction",
        route: `/${lang}/admin`,
        code: mcpError.code,
      });
      /* Compensating: delete the auth user we just created. */
      await adminSupabase.auth.admin.deleteUser(authUserId);
      return { ok: false, errorKey: "accountCreationFailed" };
    }

    /* Step 4: Create committee member record, linked to the new user. */
  
    const { data: memberId, error: memberError } = await supabase.rpc(
      "admin_create_committee_member",
      {
        p_user_id: authUserId,
        p_name_ar: nameAr,
        p_name_en: nameEn,
        p_major_ar: majorAr,
        p_major_en: majorEn,
        p_role_ar: roleAr,
        p_role_en: roleEn,
        p_gender: gender,
        p_sort_order: sortOrder,
        p_is_active: isActive,
      }
    );

    if (memberError || !memberId) {
      captureActionError(
        memberError ?? new Error("createCommitteeMember returned empty"),
        "admin_create_committee_member failed",
        {
          action: "createCommitteeMemberWithAccountAction",
          route: `/${lang}/admin`,
          code: memberError?.code,
        }
      );
      /* Compensating: delete the auth user. */
      await adminSupabase.auth.admin.deleteUser(authUserId);
      return {
        ok: false,
        errorKey: mapCommitteeRpcError(memberError?.message ?? ""),
      };
    }

    /* Step 5: Log the audit event.
       Never log passwords or credentials. Only log member_id, auth_user_id,
       and the account role that was assigned. */
    const { error: auditError } = await supabase.rpc("log_audit_event", {
      p_action: "committee_member_account_created",
      p_target_type: "committee_member",
      p_target_id: memberId as string,
      p_details: {
        auth_user_id: authUserId,
        username: actualUsername,
        account_role: accountRole,
      } as Record<string, unknown>,
    });

    if (auditError) {
      captureActionError(auditError, "log_audit_event failed", {
        action: "createCommitteeMemberWithAccountAction",
        route: `/${lang}/admin`,
        code: auditError.code,
      });
      /* Audit failure is non-fatal — the member was created successfully. */
    }

    revalidatePath(`/${lang}/admin`);
    revalidatePath(`/${lang}/about`);

    return {
      ok: true,
      id: memberId as string,
      credentials: {
        email: actualEmail,
        username: actualUsername,
        temporaryPassword,
      },
    };
  } catch (err) {
    captureActionError(err, "createCommitteeMemberWithAccountAction error", {
      action: "createCommitteeMemberWithAccountAction",
      route: `/${lang}/admin`,
    });

    /* Catch-all compensation: if we created an auth user but something
       unexpected failed, try to clean up. */
    if (authUserId) {
      try {
        await adminSupabase.auth.admin.deleteUser(authUserId);
      } catch {
        /* Best-effort cleanup. If this fails, the admin must manually
           remove the orphaned auth user from the Supabase dashboard. */
      }
    }

    return { ok: false, errorKey: "accountCreationFailed" };
  }
}

/* Update an existing committee member. */
export async function updateCommitteeMemberAction(
  _prev: CommitteeMemberActionResult,
  formData: FormData
): Promise<CommitteeMemberActionResult> {
  const lang = readLang(formData);
  const targetId = String(formData.get("targetId") ?? "");

  const session = await requireAdminActor(lang);
  if (session.role !== "admin" && session.role !== "owner") {
    return { ok: false, errorKey: "notAllowed" };
  }

  /* Rate limit: 30 requests / minute per authenticated admin */
  const { success: allowed } = await checkRateLimit(
    LIMITERS.adminAction,
    session.user.id
  );
  if (!allowed) return { ok: false, errorKey: "notAllowed" };

  const supabase = await createClient();
  const userIdRaw = String(formData.get("userId") ?? "").trim();
  const { error } = await supabase.rpc("admin_update_committee_member", {
    p_id: targetId,
    p_user_id: userIdRaw || null,
    p_name_ar: String(formData.get("nameAr") ?? ""),
    p_name_en: String(formData.get("nameEn") ?? ""),
    p_major_ar: String(formData.get("majorAr") ?? ""),
    p_major_en: String(formData.get("majorEn") ?? ""),
    p_role_ar: String(formData.get("roleAr") ?? ""),
    p_role_en: String(formData.get("roleEn") ?? ""),
    p_gender: String(formData.get("gender") ?? "") as "male" | "female",
    p_sort_order: Number(formData.get("sortOrder") ?? 0),
    p_is_active: formData.get("isActive") === "on",
  });
  if (error) {
    return { ok: false, errorKey: mapCommitteeRpcError(error.message) };
  }

  revalidatePath(`/${lang}/admin`);
  revalidatePath(`/${lang}/about`);
  return { ok: true };
}

/* Delete a committee member. */
export async function deleteCommitteeMemberAction(
  _prev: CommitteeMemberActionResult,
  formData: FormData
): Promise<CommitteeMemberActionResult> {
  const lang = readLang(formData);
  const targetId = String(formData.get("targetId") ?? "");

  const session = await requireAdminActor(lang);
  if (session.role !== "admin" && session.role !== "owner") {
    return { ok: false, errorKey: "notAllowed" };
  }

  /* Rate limit: 30 requests / minute per authenticated admin */
  const { success: allowed } = await checkRateLimit(
    LIMITERS.adminAction,
    session.user.id
  );
  if (!allowed) return { ok: false, errorKey: "notAllowed" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_committee_member", {
    p_id: targetId,
  });
  if (error) {
    return { ok: false, errorKey: mapCommitteeRpcError(error.message) };
  }

  revalidatePath(`/${lang}/admin`);
  revalidatePath(`/${lang}/about`);
  return { ok: true };
}
