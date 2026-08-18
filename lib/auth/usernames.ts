/* Canonical username rules — the single source of truth for the application.

   MUST stay in sync with supabase/migrations/20260815090005_unique_usernames.sql
   (slug_username, requested_or_slug_username, username_available, and the
   profiles_username_format_check constraint). The database is the final
   authority; this module only mirrors it so the UI and server actions can give
   friendly, consistent errors before anything reaches PostgreSQL.

   Rules (exact):
     - 3-20 characters
     - lowercase ASCII only: a-z, 0-9, underscore, period
     - first and last character must be a-z or 0-9
     - no consecutive periods
     - hyphen is NOT allowed
     - Unicode / Arabic characters are NOT allowed
*/

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

export const USERNAME_PATTERN =
  /^[a-z0-9](?!.*\.\.)[a-z0-9._]{1,18}[a-z0-9]$/;

export const RESERVED_USERNAMES = [
  "admin",
  "owner",
  "coadmin",
  "moderator",
  "support",
  "staff",
  "committee",
  "scientific",
  "root",
  "system",
] as const;

/* Usernames are normalized to lowercase before validation/comparison so the
   stored value always matches the database's case-insensitive uniqueness. */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidUsername(username: string): boolean {
  return (
    username.length >= USERNAME_MIN_LENGTH &&
    username.length <= USERNAME_MAX_LENGTH &&
    USERNAME_PATTERN.test(username)
  );
}

export function isReservedUsername(username: string): boolean {
  return (RESERVED_USERNAMES as readonly string[]).includes(username);
}
