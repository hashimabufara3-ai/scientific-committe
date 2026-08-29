"use client";

/* Shared helpers for files persisted in the content store — uploaded bytes as
   a data URL (fileData) or a static reference (fileUrl). Used by the public
   file cards and the Previous Exams section so both render files identically.

   Production (Postgres + Supabase Storage) files have NO base64 fileData. They
   are referenced by kind+id and fetched on demand as a short-lived signed URL
   from /api/resources/access (server validates the row is active, then mints
   the URL — the response carries only the URL, never Storage credentials or
   bytes). These helpers transparently prefer the signed-URL path; the legacy
   fileData/fileUrl path remains intact (and unused) for the prototype. */

export function fileSizeLabel(bytes?: number) {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* Browser-renderable kinds get an Open/View action; documents get download
   only because a doc data URL cannot render in a tab. */
export function fileKind(fileType?: string): "pdf" | "image" | "doc" {
  if (fileType === "application/pdf") return "pdf";
  if (fileType?.startsWith("image/")) return "image";
  return "doc";
}

/* Open the persisted file in a new tab WITHOUT triggering a download. Data
   URLs cannot navigate a new tab in Chromium, so the bytes are materialized
   into a blob URL — a genuinely separate action from the Download anchor. */
export function openFileInTab(fileData: string) {
  try {
    const comma = fileData.indexOf(",");
    const meta = fileData.slice(0, comma);
    const raw = fileData.slice(comma + 1);
    const mime = meta.replace(/^data:/, "").split(";")[0] || "";
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch {
    /* non-binary or unusual data URL — fall back to the raw href */
    window.open(fileData, "_blank", "noopener");
  }
}

/* ---------------------------------------------------------------------------
   Signed-URL access (production path).

   A resource is addressed by kind ("summary" | "exam") + id. The browser
   fetches a short-lived signed URL from the access route only when the user
   explicitly chooses View or Download, so file bytes and Storage credentials
   never reach the client until that moment.
   --------------------------------------------------------------------------- */

export async function fetchResourceAccess(
  kind: "summary" | "exam",
  id: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `/api/resources/access?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string };
    return typeof data.url === "string" && data.url ? data.url : null;
  } catch {
    return null;
  }
}

/* Open a stored resource in a new tab (View). Returns true when a URL was
   obtained and a new tab was opened. */
export async function openResource(
  kind: "summary" | "exam",
  id: string
): Promise<boolean> {
  const url = await fetchResourceAccess(kind, id);
  if (!url) return false;
  window.open(url, "_blank", "noopener");
  return true;
}

/* Trigger a browser download of a stored resource via the SAME-ORIGIN
   download endpoint.

   A cross-origin signed URL cannot drive a download here: browsers ignore the
   `download` attribute for cross-origin URLs, so an <a> pointed at the
   Supabase URL would navigate the current tab to the file and leave the page.
   The /api/resources/download endpoint stream-wraps the bytes with
   Content-Disposition: attachment on this same origin, so clicking the anchor
   below saves the file (with the server-derived filename) and keeps the user
   on the current /summaries page. Returns true when a download was started. */
export async function downloadResource(
  kind: "summary" | "exam",
  id: string,
  fileName: string
): Promise<boolean> {
  const url = `/api/resources/download?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName || "file";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  return true;
}
