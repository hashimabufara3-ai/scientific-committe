/* Browser-side TUS (resumable) upload helper for resource contributions.

   The byte path stays Browser -> Supabase Storage TUS endpoint. Next.js remains
   control-plane only: the browser first calls /api/resources/upload-auth, which
   authenticates/authorizes the contributor, validates the declared MIME + size,
   generates the quarantine path, and returns a short-lived signed upload token.
   The token is sent to the TUS endpoint in the `x-signature` header, so the
   browser can never choose an arbitrary storage path.

   tus-js-client is loaded with a dynamic import so it never enters the initial
   application bundle. This module is imported by the client upload component
   only; it deliberately has NO runtime imports so the pure helpers below can be
   unit-tested in Node. */

export const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
export const TUS_RETRY_DELAYS = [0, 3000, 5000, 10000, 20000];
export const TUS_CACHE_CONTROL = "3600";
export const TUS_RESOURCES_BUCKET = "resources";
export const TUS_ENDPOINT_PATH = "/storage/v1/upload/resumable/sign";

/* Derive the dedicated Storage origin (https://<ref>.storage.supabase.co) from
   a project API URL (https://<ref>.supabase.co). Returns null for anything that
   is not a Supabase project URL, so no secret or arbitrary host is ever used. */
export function deriveStorageOrigin(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null;
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:") return null;
    if (!url.hostname.endsWith(".supabase.co")) return null;
    const ref = url.hostname.slice(0, -".supabase.co".length);
    /* Project refs are dotless; guard against an already-storage hostname. */
    if (!ref || ref.includes(".")) return null;
    return `https://${ref}.storage.supabase.co`;
  } catch {
    return null;
  }
}

/* Accept an explicit NEXT_PUBLIC_SUPABASE_STORAGE_URL (preferred) or derive the
   Storage origin from the project API URL. Only https origins are accepted. */
export function storageOriginFrom(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    if (parsed.hostname.endsWith(".storage.supabase.co")) {
      return `${parsed.protocol}//${parsed.host}`;
    }
    return deriveStorageOrigin(url);
  } catch {
    return null;
  }
}

/* Build the TUS endpoint without ever hardcoding a project ref. */
export function resolveStorageTusEndpoint(options: {
  storageUrl?: string | undefined;
  supabaseUrl?: string | undefined;
}): string | null {
  const origin =
    storageOriginFrom(options.storageUrl) ?? deriveStorageOrigin(options.supabaseUrl);
  return origin ? `${origin}${TUS_ENDPOINT_PATH}` : null;
}

export type TusUploadConfig = {
  endpoint: string;
  chunkSize: number;
  retryDelays: number[];
  removeFingerprintOnSuccess: boolean;
  headers: Record<string, string>;
  metadata: Record<string, string>;
};

/* Pure option builder so the transport contract (signed token in x-signature,
   server-issued object path, correct bucket/content type, retry/chunk config)
   can be asserted without a browser or a network. */
export function buildTusUploadOptions(params: {
  endpoint: string;
  token: string;
  path: string;
  contentType: string;
  bucket?: string;
}): TusUploadConfig {
  return {
    endpoint: params.endpoint,
    chunkSize: TUS_CHUNK_SIZE,
    retryDelays: [...TUS_RETRY_DELAYS],
    removeFingerprintOnSuccess: true,
    headers: { "x-signature": params.token },
    metadata: {
      bucketName: params.bucket ?? TUS_RESOURCES_BUCKET,
      objectName: params.path,
      contentType: params.contentType,
      cacheControl: TUS_CACHE_CONTROL,
    },
  };
}

/* A TUS request rejected because the signed upload token is missing/expired.
   Callers must request a FRESH authorization instead of reusing the token. */
export class TusAuthExpiredError extends Error {
  constructor() {
    super("tus_authorization_expired");
    this.name = "TusAuthExpiredError";
  }
}

/* Structural check (no runtime import from tus-js-client) for 401/403. */
export function isTusAuthError(error: unknown): boolean {
  const response = (error as { originalResponse?: unknown } | null)?.originalResponse;
  if (!response || typeof (response as { getStatus?: unknown }).getStatus !== "function") {
    return false;
  }
  const status = (response as { getStatus: () => number }).getStatus();
  return status === 401 || status === 403;
}

export type TusUploadHandlers = {
  onProgress?: (percent: number) => void;
  onResuming?: () => void;
};

/* Run one resumable upload attempt for a server-issued token + path.

   - Retries/resume of transient failures are handled by tus-js-client
     (retryDelays) and resume from the last acknowledged offset.
   - If a previous attempt for the SAME server-issued path exists, it is resumed
     (tus persists upload URLs in local storage); a different path is never
     resumed because the token is scoped to one path.
   - A missing/expired token rejects with TusAuthExpiredError. */
export async function uploadViaTus(params: {
  file: File;
  endpoint: string;
  token: string;
  path: string;
  contentType: string;
  handlers?: TusUploadHandlers;
  signal?: AbortSignal;
}): Promise<void> {
  const config = buildTusUploadOptions({
    endpoint: params.endpoint,
    token: params.token,
    path: params.path,
    contentType: params.contentType,
  });
  const { Upload } = await import("tus-js-client");

  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(params.file, {
      endpoint: config.endpoint,
      chunkSize: config.chunkSize,
      retryDelays: config.retryDelays,
      removeFingerprintOnSuccess: config.removeFingerprintOnSuccess,
      headers: config.headers,
      metadata: config.metadata,
      onProgress: (bytesSent, bytesTotal) => {
        if (bytesTotal > 0) {
          params.handlers?.onProgress?.(Math.round((bytesSent / bytesTotal) * 100));
        }
      },
      onError: (error) => {
        if (isTusAuthError(error)) reject(new TusAuthExpiredError());
        else reject(error);
      },
      onSuccess: () => resolve(),
    });

    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      void upload.abort(false);
      reject(new DOMException("aborted", "AbortError"));
    };
    if (params.signal) {
      if (params.signal.aborted) {
        onAbort();
        return;
      }
      params.signal.addEventListener("abort", onAbort, { once: true });
    }

    void (async () => {
      try {
        const previous = await upload.findPreviousUploads();
        const match = previous.find(
          (candidate) => candidate.metadata?.objectName === params.path
        );
        if (match) {
          upload.resumeFromPreviousUpload(match);
          params.handlers?.onResuming?.();
        }
      } catch {
        /* resume lookup is best-effort */
      }
      if (params.signal?.aborted) return;
      upload.start();
    })();
  });
}
