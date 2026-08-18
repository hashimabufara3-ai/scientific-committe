"use client";

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

/* Simple {token} interpolation shared by the localized copy. */
export function fmt(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(vars[key] ?? "")
  );
}

/* Rounded technical panel using the site's card tokens — same border, surface
   and corner accents as the existing Card system, but a plain container so
   interactive forms and buttons can live inside it. */
export function Panel({
  children,
  className = "",
  cornerAccents = true,
}: {
  children: ReactNode;
  className?: string;
  cornerAccents?: boolean;
}) {
  return (
    <div
      className={`relative rounded-xl border border-white/10 bg-white/[0.03] ${className}`}
    >
      {cornerAccents && <CornerAccents />}
      {children}
    </div>
  );
}

export function CornerAccents() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <span className="absolute left-0 top-0 h-3.5 w-3.5 border-l border-t border-accent/60 opacity-50" />
      <span className="absolute right-0 top-0 h-3.5 w-3.5 border-r border-t border-accent/60 opacity-50" />
      <span className="absolute bottom-0 left-0 h-3.5 w-3.5 border-b border-l border-accent/60 opacity-50" />
      <span className="absolute bottom-0 right-0 h-3.5 w-3.5 border-b border-r border-accent/60 opacity-50" />
    </span>
  );
}

export function Kicker({ children }: { children: ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.25em] text-accent">
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 border border-accent/80"
      />
      {children}
    </p>
  );
}

/* ---- Form field primitives ----------------------------------------------- */

export function Field({
  label,
  required = false,
  optionalLabel,
  htmlFor,
  children,
}: {
  label: string;
  required?: boolean;
  optionalLabel?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-medium text-foreground"
      >
        <span>
          {label}
          {required && (
            <span aria-hidden="true" className="ms-1 text-accent">
              *
            </span>
          )}
        </span>
        {optionalLabel && (
          <span className="text-xs font-normal text-muted">{optionalLabel}</span>
        )}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-white/10 bg-ink/60 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted/60 transition-colors focus:border-accent/50 focus:outline-none";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${inputClass} min-h-28 resize-y leading-relaxed ${
        props.className ?? ""
      }`}
    />
  );
}

/* ---- Buttons ------------------------------------------------------------- */

type SmallButtonVariant = "accent" | "ghost" | "danger";

type SmallButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: SmallButtonVariant;
};

export function SmallButton({
  variant = "accent",
  className = "",
  ...props
}: SmallButtonProps) {
  const styles: Record<SmallButtonVariant, string> = {
    accent:
      "border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 hover:border-accent/60",
    ghost:
      "border-white/10 bg-white/[0.03] text-muted hover:border-white/20 hover:text-foreground",
    danger:
      "border-red-400/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-400/60",
  };
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

/* A compact version of the site's .btn-primary for in-workspace forms. */
export function PrimaryButton({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`btn-primary !px-5 !py-2 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      {...props}
    />
  );
}

export function GhostButton({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`btn-ghost !px-5 !py-2 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      {...props}
    />
  );
}

/* ---- Small decorative bits ----------------------------------------------- */

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-muted">
      {children}
    </span>
  );
}

export function AccentChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">
      {children}
    </span>
  );
}

export function SectionTitle({
  children,
  as: Tag = "h2",
}: {
  children: ReactNode;
  as?: "h2" | "h3";
}) {
  return (
    <Tag className="flex items-start gap-3 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
      <span
        aria-hidden="true"
        className="mt-1.5 inline-block h-2 w-2 shrink-0 border border-accent/80"
      />
      {children}
    </Tag>
  );
}
