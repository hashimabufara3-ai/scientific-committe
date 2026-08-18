"use client";

import { useActionState, useState } from "react";
import { updateUsername } from "../../lib/auth/actions";
import { Field, SmallButton, TextInput } from "../contribute/primitives";
import {
  isReservedUsername,
  isValidUsername,
  normalizeUsername,
} from "../../lib/auth/usernames";
import type { Dictionary } from "../../app/[lang]/dictionaries";

type AccountDict = Awaited<ReturnType<Dictionary>>["auth"]["account"];
type ErrorsDict = Awaited<ReturnType<Dictionary>>["auth"]["errors"];

/* Editable username row for the account page. Editing updates only the
   caller's own username (RLS confines writes to the own row and keeps the
   role immutable); the database unique index is the final authority. After a
   successful submit the server action revalidates the route, so the updated
   username arrives through the `username` prop; until then the freshly
   submitted value is rendered from the action state. */
export function UsernameField({
  lang,
  username,
  t,
  errors,
}: {
  lang: string;
  username: string;
  t: AccountDict;
  errors: ErrorsDict;
}) {
  const [state, formAction, pending] = useActionState(updateUsername, {});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(username);

  const success = state.success && !pending;
  const displayValue = success && state.value ? state.value : username;
  const showForm = editing && !success;
  const normalized = normalizeUsername(draft);
  const reserved = isReservedUsername(normalized);
  const invalid = !isValidUsername(normalized);

  return (
    <div className="border-t border-white/10 pt-5">
      {showForm ? (
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="lang" value={lang} />
          <Field label={t.username} htmlFor="username">
            <TextInput
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              autoFocus
            />
          </Field>
          {state.error && (
            <p role="alert" className="text-xs text-red-300">
              {state.error}
            </p>
          )}
          {invalid && (
            <p role="alert" className="text-xs text-red-300">
              {errors.usernameInvalid}
            </p>
          )}
          {!invalid && reserved && (
            <p role="alert" className="text-xs text-red-300">
              {errors.usernameReserved}
            </p>
          )}
          <div className="flex gap-2">
            <SmallButton
              variant="accent"
              type="submit"
              disabled={pending || invalid || reserved}
            >
              {t.saveUsername}
            </SmallButton>
            <SmallButton
              variant="ghost"
              type="button"
              disabled={pending}
              onClick={() => {
                setDraft(displayValue);
                setEditing(false);
              }}
            >
              {t.cancelUsername}
            </SmallButton>
          </div>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-muted">
              {t.username}
            </p>
            <p className="mt-1 truncate font-mono text-sm text-accent">
              @{displayValue}
            </p>
          </div>
          <SmallButton
            variant="ghost"
            type="button"
            onClick={() => {
              setDraft(displayValue);
              setEditing(true);
            }}
          >
            {t.editUsername}
          </SmallButton>
        </div>
      )}
    </div>
  );
}
