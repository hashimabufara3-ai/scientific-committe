"use client";

/* Shared helpers for files persisted in the content store — uploaded bytes as
   a data URL (fileData) or a static reference (fileUrl). Used by the public
   file cards and the Previous Exams section so both render files identically. */

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
