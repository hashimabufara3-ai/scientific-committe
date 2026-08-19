/* TEMPORARY diagnostic logging for production triage.
   Remove before ship. Logs sanitized request metadata only — NEVER tokens,
   credentials, cookies, headers, passwords or full email addresses. */

type Ctx = {
  method?: string;
  type?: string;
  hasToken?: boolean;
  hasRedirect?: boolean;
  hasCode?: boolean;
  hasType?: boolean;
  lang?: string;
  next?: string | null;
  pathname?: string;
  correlation?: string;
  ua?: string;
  status?: number | string;
  result?: string;
  name?: string;
  message?: string;
};

const MAX_UA = 40;
const MAX_MSG = 200;

/* Short correlation-ish id: first 8 chars of a timestamp+random hash. */
export function shortId(): string {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36).slice(-6)}${rnd}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/* Privacy-safe user-agent: first token only (browser family), truncated. */
function safeUa(ua: unknown): string | undefined {
  if (typeof ua !== "string" || !ua) return undefined;
  return truncate(ua.split(/\s+/)[0] ?? "", MAX_UA);
}

function line(tag: string, ctx: Ctx): string {
  const parts: string[] = [`[AUTH_DIAG:${tag}]`];
  if (ctx.correlation) parts.push(`corr=${ctx.correlation}`);
  if (ctx.method) parts.push(`method=${ctx.method}`);
  if (ctx.pathname) parts.push(`path=${ctx.pathname}`);
  if (ctx.type) parts.push(`type=${ctx.type}`);
  if (ctx.hasToken !== undefined) parts.push(`hasToken=${ctx.hasToken}`);
  if (ctx.hasRedirect !== undefined)
    parts.push(`hasRedirect=${ctx.hasRedirect}`);
  if (ctx.hasCode !== undefined) parts.push(`hasCode=${ctx.hasCode}`);
  if (ctx.hasType !== undefined) parts.push(`hasType=${ctx.hasType}`);
  if (ctx.lang) parts.push(`lang=${ctx.lang}`);
  if (ctx.next !== undefined && ctx.next !== null)
    parts.push(`next=${ctx.next}`);
  if (ctx.status !== undefined) parts.push(`status=${ctx.status}`);
  if (ctx.result) parts.push(`result=${ctx.result}`);
  const ua = safeUa(ctx.ua);
  if (ua) parts.push(`ua=${ua}`);
  if (ctx.name) parts.push(`name=${ctx.name}`);
  if (ctx.message) parts.push(`message="${truncate(ctx.message, MAX_MSG)}"`);
  return parts.join(" ");
}

export function diag(tag: string, ctx: Ctx): void {
  console.log(line(tag, ctx));
}
