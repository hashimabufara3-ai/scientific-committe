"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDictionary } from "../dictionaries";
import { getSessionRole } from "../../../lib/auth/authorize";
import { canAssign, isRole, type Role } from "../../../lib/auth/roles";
import { createClient } from "../../../lib/auth/supabase-server";

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
  if (m.includes("owner")) return "ownerLocked";
  if (m.includes("unchanged")) return "roleUnchanged";
  if (m.includes("own role")) return "selfChange";
  if (m.includes("not exist")) return "notFound";
  if (m.includes("transfer")) return "transferOnlyOwner";
  if (m.includes("not allowed") || m.includes("insufficient"))
    return "notAllowed";
  return "generic";
}

/* Change a member's role through assign_role(). */
export async function setRoleAction(
  _prev: AdminActionResult,
  formData: FormData
): Promise<AdminActionResult> {
  const lang = readLang(formData);
  const targetId = String(formData.get("targetId") ?? "");
  const newRoleRaw = String(formData.get("newRole") ?? "");

  const session = await getSessionRole();
  if (!session) redirect(`/${lang}/auth/sign-in`);
  if (!isRole(newRoleRaw)) return { ok: false, errorKey: "notAllowed" };
  const newRole = newRoleRaw as Role;

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
    console.error("[admin] admin_list_members() failed:", membersError);
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

  const session = await getSessionRole();
  if (!session) redirect(`/${lang}/auth/sign-in`);
  if (session.role !== "owner") {
    return { ok: false, errorKey: "transferOnlyOwner" };
  }
  if (targetId === session.user.id) {
    return { ok: false, errorKey: "transferSelf" };
  }

  const supabase = await createClient();
  const { data: members, error: membersError } = await supabase.rpc(
    "admin_list_members"
  );
  if (membersError) {
    console.error("[admin] admin_list_members() failed:", membersError);
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

  const session = await getSessionRole();
  if (!session) redirect(`/${lang}/auth/sign-in`);
  if (session.role !== "admin" && session.role !== "owner") {
    return { ok: false, errorKey: "notAllowed" };
  }

  const supabase = await createClient();
  const userIdRaw = String(formData.get("userId") ?? "").trim();
  const { data: newId, error } = await supabase.rpc(
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
  return { ok: true, id: newId as string };
}

/* Update an existing committee member. */
export async function updateCommitteeMemberAction(
  _prev: CommitteeMemberActionResult,
  formData: FormData
): Promise<CommitteeMemberActionResult> {
  const lang = readLang(formData);
  const targetId = String(formData.get("targetId") ?? "");

  const session = await getSessionRole();
  if (!session) redirect(`/${lang}/auth/sign-in`);
  if (session.role !== "admin" && session.role !== "owner") {
    return { ok: false, errorKey: "notAllowed" };
  }

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

  const session = await getSessionRole();
  if (!session) redirect(`/${lang}/auth/sign-in`);
  if (session.role !== "admin" && session.role !== "owner") {
    return { ok: false, errorKey: "notAllowed" };
  }

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
