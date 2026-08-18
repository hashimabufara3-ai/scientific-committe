/* Subject titles follow the site-wide convention `MainName — Subtitle`.
   Cards must show only the main/general name, so split at the separator.
   Titles without a separator are returned unchanged. */
export function subjectName(title: string): string {
  return title.split(" — ")[0] || title;
}
