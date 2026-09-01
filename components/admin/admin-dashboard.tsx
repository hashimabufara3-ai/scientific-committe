"use client";

import { useActionState, useState } from "react";
import type { Dictionary } from "@/app/[lang]/dictionaries";
import {
  setRoleAction,
  transferOwnershipAction,
  deleteAccountAction,
  changeMemberPasswordAction,
  type AdminActionResult,
} from "@/app/[lang]/admin/actions";
import { canAssign, ROLES, type Role } from "@/lib/auth/roles";
import {
  AccentChip,
  Chip,
  Panel,
  PrimaryButton,
  SmallButton,
  TextInput,
} from "../contribute/primitives";
import { SearchIcon, UsersIcon } from "../icons";

type AdminDict = Awaited<ReturnType<Dictionary>>["adminPage"];
type RoleLabels = Awaited<ReturnType<Dictionary>>["auth"]["account"]["roles"];

type Member = {
  id: string;
  full_name: string;
  username: string;
  role: Role;
  created_at: string;
};

const INITIAL_STATE: AdminActionResult = { ok: false };

const TRANSITION_LABEL: Record<Role, keyof AdminDict["transitions"]> = {
  student: "toStudent",
  contributor: "toContributor",
  admin: "toAdmin",
  /* owner is never a valid transition target (see canAssign) */
  owner: "toAdmin",
};

/* The server actions call revalidatePath() on success, so the router's
   server-action navigation already refreshes the tree with fresh data. No
   client-side router.refresh() is needed. */

function formatDate(lang: string, iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

/* Delete-target gating for the UI. This is UX only — the SECURITY DEFINER
   admin_delete_user() RPC re-enforces the exact same rules server-side and is
   authoritative even if this gating is bypassed. Mirrors the RPC rules:
     - nobody may delete the Owner;
     - admin may delete student/contributor only;
     - owner may delete admin/student/contributor. */
function canDeleteMember(actor: Role, targetRole: Role): boolean {
  if (targetRole === "owner") return false;
  if (actor === "owner") return true;
  if (actor === "admin") {
    return targetRole === "student" || targetRole === "contributor";
  }
  return false;
}

/* Mirror of the server-side canResetPassword() gating in admin/actions.ts.
   UI convenience only — the server action re-enforces the exact same rule. */
function canResetPasswordMember(actor: Role, targetRole: Role): boolean {
  if (targetRole === "owner") return false;
  if (actor === "owner") return true;
  if (actor === "admin") {
    return targetRole === "student" || targetRole === "contributor";
  }
  return false;
}

/* One member row. The visible transitions are the exact allowlist entries the
   current actor may perform on this member — anything else is not rendered
   and is rejected server-side anyway. */
function MemberRow({
  member,
  currentUserId,
  currentRole,
  lang,
  t,
  roleLabels,
}: {
  member: Member;
  currentUserId: string;
  currentRole: Role;
  lang: string;
  t: AdminDict;
  roleLabels: RoleLabels;
}) {
  const [state, formAction, pending] = useActionState(
    setRoleAction,
    INITIAL_STATE
  );
  const [deleteState, deleteFormAction, deletePending] = useActionState(
    deleteAccountAction,
    INITIAL_STATE
  );
  const [passwordState, passwordFormAction, passwordPending] = useActionState(
    changeMemberPasswordAction,
    INITIAL_STATE
  );
  const [confirming, setConfirming] = useState(false);
  const [passwordEditing, setPasswordEditing] = useState(false);

  const isSelf = member.id === currentUserId;
  const transitions = ROLES.filter((role) =>
    canAssign(currentRole, member.role, role)
  );
  /* errorKey is only set after a failed action, so the pristine initial
     state ({ ok: false }) shows no error. */
  const error = state.errorKey ? t.errors[state.errorKey] : null;
  const deleteError = deleteState.errorKey
    ? t.errors[deleteState.errorKey]
    : null;
  const passwordError = passwordState.errorKey
    ? t.errors[passwordState.errorKey]
    : null;
  const canDelete = !isSelf && canDeleteMember(currentRole, member.role);
  const canResetPw = !isSelf && canResetPasswordMember(currentRole, member.role);

  return (
    <Panel className="p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">
              {member.full_name || t.unnamed}
            </p>
            {member.username && (
              <p className="font-mono text-xs text-muted">
                @{member.username}
              </p>
            )}
            {isSelf && <AccentChip>{t.you}</AccentChip>}
            {member.role === "owner" && <AccentChip>{roleLabels.owner}</AccentChip>}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {t.memberSince} {formatDate(lang, member.created_at)}
          </p>
        </div>

        <div className="shrink-0">
          <Chip>{roleLabels[member.role]}</Chip>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-red-300">
          {error}
        </p>
      )}

      {transitions.length > 0 ? (
        <form action={formAction} className="mt-4 flex flex-wrap gap-2">
          <input type="hidden" name="lang" value={lang} />
          <input type="hidden" name="targetId" value={member.id} />
          {transitions.map((role) => (
            <button
              key={role}
              type="submit"
              name="newRole"
              value={role}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t.transitions[TRANSITION_LABEL[role]]}
            </button>
          ))}
        </form>
      ) : (
        !isSelf &&
        member.role !== "owner" && (
          <p className="mt-3 text-xs text-muted">{t.noControls}</p>
        )
      )}

      {canDelete && (
        <div className="mt-4 border-t border-white/5 pt-4">
          {confirming ? (
            <div className="space-y-3">
              <p className="text-sm text-foreground">
                {t.deleteConfirm}{" "}
                <span className="font-semibold">
                  {member.full_name || t.unnamed}
                </span>
              </p>
              {deleteError && (
                <p role="alert" className="text-xs text-red-300">
                  {deleteError}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <form action={deleteFormAction}>
                  <input type="hidden" name="lang" value={lang} />
                  <input type="hidden" name="targetId" value={member.id} />
                  <SmallButton
                    variant="danger"
                    type="submit"
                    disabled={deletePending}
                  >
                    {deletePending ? t.deleting : t.delete}
                  </SmallButton>
                </form>
                <SmallButton
                  variant="ghost"
                  onClick={() => setConfirming(false)}
                  disabled={deletePending}
                >
                  {t.cancel}
                </SmallButton>
              </div>
            </div>
          ) : (
            <SmallButton variant="danger" onClick={() => setConfirming(true)}>
              {t.delete}
            </SmallButton>
          )}
        </div>
      )}

      {canResetPw && (
        <div className="mt-4 border-t border-white/5 pt-4">
          {passwordEditing ? (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-foreground">
                {t.changePassword.title}
              </p>
              <form action={passwordFormAction} className="space-y-3">
                <input type="hidden" name="lang" value={lang} />
                <input type="hidden" name="targetId" value={member.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor={`new-pw-${member.id}`}
                      className="mb-1.5 block text-xs font-medium text-muted"
                    >
                      {t.changePassword.newPassword}
                    </label>
                    <TextInput
                      id={`new-pw-${member.id}`}
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      minLength={6}
                      required
                      placeholder={t.changePassword.newPasswordPlaceholder}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`confirm-pw-${member.id}`}
                      className="mb-1.5 block text-xs font-medium text-muted"
                    >
                      {t.changePassword.confirmPassword}
                    </label>
                    <TextInput
                      id={`confirm-pw-${member.id}`}
                      name="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      minLength={6}
                      required
                      placeholder={t.changePassword.confirmPasswordPlaceholder}
                    />
                  </div>
                </div>
                {passwordError && (
                  <p role="alert" className="text-xs text-red-300">
                    {passwordError}
                  </p>
                )}
                {passwordState.ok && (
                  <p role="status" className="text-xs text-accent">
                    {t.changePassword.success}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <SmallButton
                    variant="accent"
                    type="submit"
                    disabled={passwordPending}
                  >
                    {passwordPending
                      ? t.changePassword.submitting
                      : t.changePassword.submit}
                  </SmallButton>
                  <SmallButton
                    variant="ghost"
                    type="button"
                    disabled={passwordPending}
                    onClick={() => setPasswordEditing(false)}
                  >
                    {t.cancel}
                  </SmallButton>
                </div>
              </form>
            </div>
          ) : (
            <SmallButton
              variant="ghost"
              onClick={() => setPasswordEditing(true)}
            >
              {t.changePassword.title}
            </SmallButton>
          )}
        </div>
      )}
    </Panel>
  );
}

/* Owner-only: select a target and type their full name to confirm. The typed
   confirmation is validated here for UX and re-validated in the server action. */
function TransferSection({
  members,
  currentUserId,
  lang,
  t,
}: {
  members: Member[];
  currentUserId: string;
  lang: string;
  t: AdminDict;
}) {
  const [state, formAction, pending] = useActionState(
    transferOwnershipAction,
    INITIAL_STATE
  );

  const [selectedId, setSelectedId] = useState("");
  const [typedName, setTypedName] = useState("");

  const candidates = members.filter((member) => member.id !== currentUserId);
  const selected = candidates.find((member) => member.id === selectedId);
  const matched =
    selected !== undefined &&
    (selected.full_name || t.unnamed).trim().toLowerCase() ===
      typedName.trim().toLowerCase();
  /* errorKey is only set after a failed action, so the pristine initial
     state ({ ok: false }) shows no error. */
  const error = state.errorKey ? t.errors[state.errorKey] : null;

  return (
    <Panel className="p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <UsersIcon className="h-5 w-5 shrink-0 text-accent" />
        <h2 className="text-lg font-semibold text-foreground">
          {t.transfer.title}
        </h2>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        {t.transfer.subtitle}
      </p>

      <form action={formAction} className="mt-6 space-y-5">
        <input type="hidden" name="lang" value={lang} />

        <div>
          <label
            htmlFor="transfer-target"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            {t.transfer.target}
          </label>
          <select
            id="transfer-target"
            name="targetId"
            value={selectedId}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setTypedName("");
            }}
            className="w-full rounded-lg border border-white/10 bg-ink/60 px-3.5 py-2.5 text-sm text-foreground focus:border-accent/50 focus:outline-none"
          >
            <option value="" disabled>
              {t.transfer.targetPlaceholder}
            </option>
            {candidates.map((member) => (
              <option key={member.id} value={member.id}>
                {member.full_name || t.unnamed}
                {member.username ? ` · @${member.username}` : ""}
              </option>
            ))}
          </select>
        </div>

        {selected && (
          <div>
            <label
              htmlFor="transfer-confirm"
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              {t.transfer.confirm}
            </label>
            <TextInput
              id="transfer-confirm"
              name="confirmName"
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              placeholder={t.transfer.confirmPlaceholder}
              autoComplete="off"
            />
          </div>
        )}

        <p className="rounded-lg border border-accent/20 bg-accent/5 px-4 py-3 text-xs leading-relaxed text-accent">
          {t.transfer.notice}
        </p>

        {error && (
          <p role="alert" className="text-xs text-red-300">
            {error}
          </p>
        )}

        <PrimaryButton
          type="submit"
          disabled={!selected || !matched || pending}
          className="w-full"
        >
          {t.transfer.submit}
        </PrimaryButton>
      </form>
    </Panel>
  );
}

export default function AdminDashboard({
  lang,
  t,
  roleLabels,
  currentUserId,
  currentRole,
  members,
  loadFailed,
}: {
  lang: string;
  t: AdminDict;
  roleLabels: RoleLabels;
  currentUserId: string;
  currentRole: Role;
  members: Member[];
  loadFailed: boolean;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? members.filter((member) =>
        (member.full_name || "").toLowerCase().includes(q) ||
        (member.username || "").toLowerCase().includes(q)
      )
    : members;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <TextInput
          aria-label={t.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.search}
          className="!ps-10"
        />
      </div>

      {loadFailed ? (
        <div role="alert">
          <Panel className="p-6 text-center text-sm text-red-300">
            {t.loadError}
          </Panel>
        </div>
      ) : (
        <>
          {currentRole === "owner" && (
            <TransferSection
              members={members}
              currentUserId={currentUserId}
              lang={lang}
              t={t}
            />
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <UsersIcon className="h-5 w-5 shrink-0 text-accent" />
                <h2 className="text-lg font-semibold text-foreground">
                  {t.membersTitle}
                </h2>
              </div>
              <Chip>{String(filtered.length)}</Chip>
            </div>

            {filtered.length === 0 ? (
              <Panel className="p-6 text-center text-sm text-muted">
                {t.searchEmpty}
              </Panel>
            ) : (
              filtered.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  currentUserId={currentUserId}
                  currentRole={currentRole}
                  lang={lang}
                  t={t}
                  roleLabels={roleLabels}
                />
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
