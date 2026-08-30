import Link from "next/link";

/* Shared status/feedback presentation used by BOTH the localized Error
   Boundary (app/[lang]/error.tsx) and the soft-deleted material state.

   It is intentionally a plain, presentational component with no hooks and no
   server-only APIs, so it can be imported by a Server Component (the deleted
   material page) and a Client Component (the error boundary) alike.

   Visual language is that of app/[lang]/error.tsx: a centered <main> with a
   tracking-spaced kicker, a large heading, a `role="status"` body paragraph,
   and an optional row of actions (buttons and/or links). The calling screens
   supply their own strings and actions, so the semantics of each state stay
   distinct (error vs deleted vs real 404) while sharing one design. */

export type StatusFeedbackAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: "primary" | "ghost";
};

export type StatusFeedbackProps = {
  kicker: string;
  title: string;
  body: string;
  actions?: StatusFeedbackAction[];
  dir?: "ltr" | "rtl";
};

export default function StatusFeedback({
  kicker,
  title,
  body,
  actions = [],
  dir = "ltr",
}: StatusFeedbackProps) {
  return (
    <main
      id="main-content"
      dir={dir}
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-4 py-28 text-center sm:px-6"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
        {kicker}
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
        {title}
      </h1>
      <p
        className="mt-6 max-w-md text-base leading-relaxed text-muted"
        role="status"
      >
        {body}
      </p>
      {actions.length > 0 && (
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          {actions.map((action, index) => {
            const cls =
              action.variant === "ghost" ? "btn-ghost" : "btn-primary";
            if (action.href) {
              return (
                <Link key={index} href={action.href} className={cls}>
                  {action.label}
                </Link>
              );
            }
            return (
              <button
                key={index}
                type="button"
                onClick={action.onClick}
                className={cls}
              >
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </main>
  );
}
