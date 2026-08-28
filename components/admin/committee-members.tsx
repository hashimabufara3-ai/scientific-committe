"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import type { Dictionary } from "@/app/[lang]/dictionaries";
import {
  createCommitteeMemberAction,
  createCommitteeMemberWithAccountAction,
  updateCommitteeMemberAction,
  deleteCommitteeMemberAction,
  type CommitteeMemberActionResult,
  type CommitteeMemberWithAccountActionResult,
} from "@/app/[lang]/admin/actions";
import {
  Panel,
  PrimaryButton,
  SmallButton,
  TextInput,
  Field,
  Chip,
} from "../contribute/primitives";
import { SearchIcon, UsersIcon, SparkIcon } from "../icons";

type CommitteeMembersDict =
  Awaited<ReturnType<Dictionary>>["adminPage"]["committeeMembers"];

type CommitteeMember = {
  id: string;
  user_id: string | null;
  name_ar: string;
  name_en: string;
  major_ar: string;
  major_en: string;
  role_ar: string;
  role_en: string;
  gender: "male" | "female";
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type SiteUser = {
  id: string;
  full_name: string;
  username: string;
};

const INITIAL_STATE: CommitteeMemberActionResult = { ok: false };

/* ------------------------------------------------------------------ */
/* Member form (add / edit)                                           */
/* ------------------------------------------------------------------ */

function MemberForm({
  lang,
  t,
  member,
  users,
  currentRole,
  onDone,
  savedScrollY,
}: {
  lang: string;
  t: CommitteeMembersDict;
  member?: CommitteeMember;
  users: SiteUser[];
  currentRole: "student" | "contributor" | "admin" | "owner";
  onDone: () => void;
  savedScrollY: { current: number };
}) {
  const isEdit = !!member;
  const [createAccount, setCreateAccount] = useState(false);
  /* Account role for a newly created website account. Defaults to Student.
     The chooser is UX only — the server action re-validates via assign_role(). */
  const [accountRole, setAccountRole] = useState<"student" | "contributor" | "admin">(
    "student"
  );

  /* Use the with-account action when creating a new member with account,
     otherwise use the standard create/edit actions.
     All three actions accept FormData and return compatible results;
     the _prev parameter is never used, so the type variance is safe. */
  const selectedAction = isEdit
    ? updateCommitteeMemberAction
    : createAccount
      ? createCommitteeMemberWithAccountAction
      : createCommitteeMemberAction;
  const [state, formAction, pending] = useActionState(
    selectedAction as (
      state:
        | CommitteeMemberActionResult
        | CommitteeMemberWithAccountActionResult,
      formData: FormData
    ) =>
      | CommitteeMemberActionResult
      | CommitteeMemberWithAccountActionResult
      | Promise<CommitteeMemberActionResult | CommitteeMemberWithAccountActionResult>,
    INITIAL_STATE
  );

  /* Close the form on success — unless credentials were returned (account
     creation), in which case we keep the form open so the admin can copy
     the email / username / temporary password. The admin must explicitly
     click "Done" to dismiss the credentials panel. */
  const hasCredentials =
    "credentials" in state && !!state.credentials;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (state.ok && !hasCredentials) {
      const y = savedScrollY.current;
      requestAnimationFrame(() => window.scrollTo(0, y));
      onDone();
    }
  }, [state.ok, hasCredentials, onDone, savedScrollY]);

  /* errorKey is only set after a failed action, so the pristine initial
     state ({ ok: false }) shows no error. */
  const error = state.errorKey
    ? state.errorKey === "duplicateUser"
      ? t.duplicateUser
      : t.formErrors.generic
    : null;

  /* Simple client-side required-field indicators. */
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const markTouched = (name: string) =>
    setTouched((prev) => ({ ...prev, [name]: true }));

  const showReq = (name: string) =>
    touched[name] ? "border-red-400/50" : "";

  return (
    <Panel className="p-6">
      <h3 className="text-lg font-semibold text-foreground">
        {isEdit ? t.editTitle : t.addTitle}
      </h3>

      <form
        action={formAction}
        className="mt-5 space-y-4"
        onSubmit={(e) => {
          /* Mark all fields touched so validation indicators show. */
          const fields = [
            "nameAr",
            "nameEn",
            "majorAr",
            "majorEn",
            "roleAr",
            "roleEn",
            "gender",
          ];
          const next: Record<string, boolean> = {};
          for (const f of fields) next[f] = true;
          setTouched(next);

          /* Basic client-side check: let the browser handle required. */
          const fd = new FormData(e.currentTarget);
          const required = [
            "nameAr",
            "nameEn",
            "majorAr",
            "majorEn",
            "roleAr",
            "roleEn",
            "gender",
          ];
          for (const name of required) {
            if (!String(fd.get(name) ?? "").trim()) {
              e.preventDefault();
              return;
            }
          }
        }}
      >
        <input type="hidden" name="lang" value={lang} />
        {isEdit && <input type="hidden" name="targetId" value={member.id} />}

        {/* Arabic fields */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.nameAr} required htmlFor="cm-name-ar">
            <TextInput
              id="cm-name-ar"
              name="nameAr"
              defaultValue={member?.name_ar}
              required
              onBlur={() => markTouched("nameAr")}
              className={showReq("nameAr")}
            />
          </Field>
          <Field label={t.nameEn} required htmlFor="cm-name-en">
            <TextInput
              id="cm-name-en"
              name="nameEn"
              defaultValue={member?.name_en}
              required
              onBlur={() => markTouched("nameEn")}
              className={showReq("nameEn")}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.majorAr} required htmlFor="cm-major-ar">
            <TextInput
              id="cm-major-ar"
              name="majorAr"
              defaultValue={member?.major_ar}
              required
              onBlur={() => markTouched("majorAr")}
              className={showReq("majorAr")}
            />
          </Field>
          <Field label={t.majorEn} required htmlFor="cm-major-en">
            <TextInput
              id="cm-major-en"
              name="majorEn"
              defaultValue={member?.major_en}
              required
              onBlur={() => markTouched("majorEn")}
              className={showReq("majorEn")}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.roleAr} required htmlFor="cm-role-ar">
            <TextInput
              id="cm-role-ar"
              name="roleAr"
              defaultValue={member?.role_ar}
              required
              onBlur={() => markTouched("roleAr")}
              className={showReq("roleAr")}
            />
          </Field>
          <Field label={t.roleEn} required htmlFor="cm-role-en">
            <TextInput
              id="cm-role-en"
              name="roleEn"
              defaultValue={member?.role_en}
              required
              onBlur={() => markTouched("roleEn")}
              className={showReq("roleEn")}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t.gender} required htmlFor="cm-gender">
            <select
              id="cm-gender"
              name="gender"
              defaultValue={member?.gender ?? ""}
              required
              onBlur={() => markTouched("gender")}
              className={`w-full rounded-lg border border-white/10 bg-ink/60 px-3.5 py-2.5 text-sm text-foreground focus:border-accent/50 focus:outline-none ${showReq("gender")}`}
            >
              <option value="" disabled>
                —
              </option>
              <option value="female">{t.genderFemale}</option>
              <option value="male">{t.genderMale}</option>
            </select>
            <p className="mt-1.5 text-xs leading-snug text-muted">
              {t.genderHelper}
            </p>
          </Field>

          <Field label={t.sortOrder} htmlFor="cm-sort">
            <TextInput
              id="cm-sort"
              name="sortOrder"
              type="number"
              defaultValue={member?.sort_order ?? 0}
              min={0}
            />
          </Field>

          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked={member?.is_active ?? true}
                className="h-4 w-4 rounded border-white/20 bg-ink/60 accent-accent"
              />
              {t.isActive}
            </label>
          </div>
        </div>

        {isEdit ? (
          /* Edit mode: show existing user selector */
          <Field label={t.websiteUser} htmlFor="cm-user-id">
            <select
              id="cm-user-id"
              name="userId"
              defaultValue={member?.user_id ?? ""}
              className="w-full rounded-lg border border-white/10 bg-ink/60 px-3.5 py-2.5 text-sm text-foreground focus:border-accent/50 focus:outline-none"
            >
              <option value="">{t.noWebsiteAccount}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name || "—"}
                  {u.username ? ` · @${u.username}` : ""}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs leading-snug text-muted">
              {t.websiteUserHelper}
            </p>
          </Field>
        ) : (
          /* Add mode: show create-account toggle only. When enabled, choose
             the new account's role below it. There is no existing-user
             selector here — accounts are created fresh. */
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  name="createAccount"
                  checked={createAccount}
                  onChange={(e) => {
                    setCreateAccount(e.target.checked);
                    setAccountRole("student");
                  }}
                  className="h-4 w-4 rounded border-white/20 bg-ink/60 accent-accent"
                />
                {t.createAccount}
              </label>
            </div>
            {createAccount && (
              <>
                <p className="rounded-lg border border-accent/20 bg-accent/5 px-4 py-3 text-xs leading-relaxed text-accent">
                  {t.createAccountHelper}
                </p>
                {/* Account role chooser. Visibility is UX only: the server
                    reassigns via assign_role(), which authoritatively enforces
                    the actor's capability. Admin never sees "Make admin";
                    owner never sees an Owner option. */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted">
                    {t.accountRole}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <label
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm transition-colors ${
                        accountRole === "student"
                          ? "border-accent/60 bg-accent/10 text-foreground"
                          : "border-white/10 bg-ink/60 text-foreground hover:border-white/20"
                      }`}
                    >
                      <input
                        type="radio"
                        name="accountRole"
                        value="student"
                        checked={accountRole === "student"}
                        onChange={() => setAccountRole("student")}
                        className="sr-only"
                      />
                      {t.roleStudent}
                    </label>

                    <label
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm transition-colors ${
                        accountRole === "contributor"
                          ? "border-accent/60 bg-accent/10 text-foreground"
                          : "border-white/10 bg-ink/60 text-foreground hover:border-white/20"
                      }`}
                    >
                      <input
                        type="radio"
                        name="accountRole"
                        value="contributor"
                        checked={accountRole === "contributor"}
                        onChange={() => setAccountRole("contributor")}
                        className="sr-only"
                      />
                      {t.makeContributor}
                    </label>

                    {currentRole === "owner" && (
                      <label
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm transition-colors ${
                          accountRole === "admin"
                            ? "border-accent/60 bg-accent/10 text-foreground"
                            : "border-white/10 bg-ink/60 text-foreground hover:border-white/20"
                        }`}
                      >
                        <input
                          type="radio"
                          name="accountRole"
                          value="admin"
                          checked={accountRole === "admin"}
                          onChange={() => setAccountRole("admin")}
                          className="sr-only"
                        />
                        {t.makeAdmin}
                      </label>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Credentials display (shown once after account creation) */}
        {"credentials" in state && state.credentials && (
          <Panel className="border-green-500/30 bg-green-500/5 p-4">
            <p className="text-sm font-semibold text-green-300">
              {t.accountCreated}
            </p>
            <div className="mt-3 space-y-1.5 text-xs">
              <p>
                <span className="text-muted">{t.credentialsEmail}: </span>
                <span className="font-mono text-foreground">
                  {state.credentials.email}
                </span>
              </p>
              <p>
                <span className="text-muted">{t.credentialsUsername}: </span>
                <span className="font-mono text-foreground">
                  {state.credentials.username}
                </span>
              </p>
              <p>
                <span className="text-muted">
                  {t.credentialsTemporaryPassword}:{" "}
                </span>
                <span className="font-mono text-foreground">
                  {state.credentials.temporaryPassword}
                </span>
              </p>
            </div>
            <p className="mt-3 text-xs text-yellow-300">
              {t.credentialsWarning}
            </p>
            <div className="mt-4">
              <PrimaryButton type="button" onClick={onDone}>
                {t.credentialsDone}
              </PrimaryButton>
            </div>
          </Panel>
        )}

        {/* Error */}
        {error && (
          <p role="alert" className="text-xs text-red-300">
            {error}
          </p>
        )}

        {/* Hide submit/cancel when credentials are displayed — the only
            way to close the form is the "Done" button inside the panel. */}
        {!hasCredentials && (
          <div className="flex gap-3 pt-2">
            <PrimaryButton type="submit" disabled={pending}>
              {pending ? t.saving : t.save}
            </PrimaryButton>
            <SmallButton variant="ghost" onClick={onDone}>
              {t.cancel}
            </SmallButton>
          </div>
        )}
      </form>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Single member row                                                  */
/* ------------------------------------------------------------------ */

function MemberRow({
  member,
  lang,
  t,
  users,
  onEdit,
  onDelete,
}: {
  member: CommitteeMember;
  lang: string;
  t: CommitteeMembersDict;
  users: SiteUser[];
  onEdit: (m: CommitteeMember) => void;
  onDelete: (m: CommitteeMember) => void;
}) {
  const linkedUser = member.user_id
    ? users.find((u) => u.id === member.user_id)
    : null;

  return (
    <Panel className="p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">
              {member.name_en}
            </p>
            <p className="text-sm text-muted">{member.name_ar}</p>
            {!member.is_active && <Chip>{t.inactive}</Chip>}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {member.role_en} / {member.role_ar} — {member.major_en}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {member.gender === "female" ? t.genderFemale : t.genderMale} ·{" "}
            {t.sortOrder}: {member.sort_order}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {linkedUser
              ? `${t.linkedAccount}: ${linkedUser.full_name || "—"}${linkedUser.username ? ` · @${linkedUser.username}` : ""}`
              : t.notLinked}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <SmallButton variant="accent" onClick={() => onEdit(member)}>
            {t.edit}
          </SmallButton>
          <SmallButton variant="danger" onClick={() => onDelete(member)}>
            {t.delete}
          </SmallButton>
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Main section                                                       */
/* ------------------------------------------------------------------ */

export default function CommitteeMembersSection({
  lang,
  t,
  members,
  users,
  currentRole,
  loadFailed,
}: {
  lang: string;
  t: CommitteeMembersDict;
  members: CommitteeMember[];
  users: SiteUser[];
  currentRole: "student" | "contributor" | "admin" | "owner";
  loadFailed: boolean;
}) {
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CommitteeMember | null>(null);
  const [deleting, setDeleting] = useState<CommitteeMember | null>(null);
  const [deleteState, deleteAction, deletePending] = useActionState<
    CommitteeMemberActionResult,
    FormData
  >(deleteCommitteeMemberAction, INITIAL_STATE);

  /* Scroll position saved before the edit/delete form opens so we can
     restore it after the server action's automatic scroll-to-top. */
  const savedScrollY = useRef(0);

  const reduceMotion = useReducedMotion();
  const editFormRef = useRef<HTMLDivElement>(null);
  /* When an edit form opens, scroll the viewport to the form itself (with a
     small scroll-margin-top so it clears the sticky navbar) instead of
     jumping to the top of the page. Runs after the form has rendered. */
  useEffect(() => {
    if (!editing || !editFormRef.current) return;
    editFormRef.current.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
  }, [editing, reduceMotion]);

  const firstDelete = useRef(true);
  useEffect(() => {
    if (firstDelete.current) {
      firstDelete.current = false;
      return;
    }
    if (deleteState.ok) {
      const y = savedScrollY.current;
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
    /* Depend on the deleteState object (a new identity per action
       resolution) so consecutive successful deletes both restore scroll. */
  }, [deleteState]);

  /* If the deleted member is no longer in the refreshed list, the delete
     panel will simply not render (see `showDeletePanel` below). No
     setState-in-effect needed. */

  const q = query.trim().toLowerCase();
  const filtered = q
    ? members.filter(
        (m) =>
          m.name_en.toLowerCase().includes(q) ||
          m.name_ar.includes(q) ||
          m.role_en.toLowerCase().includes(q) ||
          m.role_ar.includes(q)
      )
    : members;

  /* Show the delete confirmation only if the target member still exists
     in the (possibly refreshed) members list. Once the server re-renders
     after a successful delete, the member disappears from the list and
     the panel auto-dismisses without needing a setState-in-effect. */
  const showDeletePanel = deleting && members.some((m) => m.id === deleting.id);

  if (loadFailed) {
    return (
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <UsersIcon className="h-5 w-5 shrink-0 text-accent" />
          <h2 className="text-lg font-semibold text-foreground">
            {t.title}
          </h2>
        </div>
        <Panel className="p-6 text-center text-sm text-red-300">
          {t.empty}
        </Panel>
      </section>
    );
  }

  const hasMembers = members.length > 0;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <UsersIcon className="h-5 w-5 shrink-0 text-accent" />
          <h2 className="text-lg font-semibold text-foreground">
            {t.title}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {hasMembers && <Chip>{String(members.length)}</Chip>}
          {!showForm && !editing && (
            <PrimaryButton
              onClick={() => {
                savedScrollY.current = window.scrollY;
                setShowForm(true);
              }}
            >
              {t.add}
            </PrimaryButton>
          )}
        </div>
      </div>
      <p className="text-sm text-muted">{t.subtitle}</p>
      <p className="rounded-lg border border-accent/20 bg-accent/5 px-4 py-3 text-xs leading-relaxed text-accent">
        {t.note}
      </p>

      {/* Add form */}
      {showForm && !editing && (
        <MemberForm
          lang={lang}
          t={t}
          users={users}
          currentRole={currentRole}
          onDone={() => setShowForm(false)}
          savedScrollY={savedScrollY}
        />
      )}

      {/* Edit form */}
      {editing && (
        <div ref={editFormRef} className="scroll-mt-24">
          <MemberForm
            lang={lang}
            t={t}
            member={editing}
            users={users}
            currentRole={currentRole}
            onDone={() => setEditing(null)}
            savedScrollY={savedScrollY}
          />
        </div>
      )}

      {/* Delete confirmation */}
      {showDeletePanel && deleting && (
        <Panel className="p-6">
          <p className="text-sm text-foreground">
            {t.deleteConfirm}{" "}
            <span className="font-semibold">
              {deleting.name_en} / {deleting.name_ar}
            </span>
          </p>
          <div className="mt-4 flex gap-3">
            <form action={deleteAction}>
              <input type="hidden" name="lang" value={lang} />
              <input type="hidden" name="targetId" value={deleting.id} />
              <PrimaryButton
                type="submit"
                disabled={deletePending}
                className="!bg-red-500/20 !border-red-400/40 !text-red-300 hover:!bg-red-500/30"
              >
                {deletePending ? t.saving : t.delete}
              </PrimaryButton>
            </form>
            <SmallButton variant="ghost" onClick={() => setDeleting(null)}>
              {t.cancel}
            </SmallButton>
          </div>
          {deleteState.errorKey && (
            <p role="alert" className="mt-3 text-xs text-red-300">
              {t.formErrors.generic}
            </p>
          )}
        </Panel>
      )}

      {/* Empty state — no members at all */}
      {!hasMembers && !showForm && !editing && (
        <Panel className="p-8 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
            <SparkIcon className="h-6 w-6" />
          </span>
          <h3 className="mt-4 text-base font-semibold text-foreground">
            {t.emptyTitle}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {t.emptyDescription}
          </p>
          <div className="mt-5">
            <PrimaryButton
              onClick={() => {
                savedScrollY.current = window.scrollY;
                setShowForm(true);
              }}
            >
              {t.add}
            </PrimaryButton>
          </div>
        </Panel>
      )}

      {/* Search + member list (only when members exist) */}
      {hasMembers && (
        <>
          {/* Search */}
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <TextInput
              aria-label={t.title}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.title}
              className="!ps-10"
            />
          </div>

          {/* Member list */}
          {filtered.length === 0 ? (
            <Panel className="p-6 text-center text-sm text-muted">
              {t.noResults}
            </Panel>
          ) : (
            filtered.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                lang={lang}
                t={t}
                users={users}
                onEdit={(m) => {
                  savedScrollY.current = window.scrollY;
                  setShowForm(false);
                  setEditing(m);
                }}
                onDelete={(m) => {
                  savedScrollY.current = window.scrollY;
                  setDeleting(m);
                }}
              />
            ))
          )}
        </>
      )}
    </section>
  );
}
