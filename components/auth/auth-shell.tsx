import type { ReactNode } from "react";
import { Kicker, Panel } from "../contribute/primitives";

/* Shared card layout for all authentication pages. */
export function AuthShell({
  kicker,
  title,
  subtitle,
  children,
}: {
  kicker: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 sm:px-6"
    >
      <div className="mx-auto w-full max-w-md pt-16 sm:pt-24">
        <div className="mb-8 text-center">
          <Kicker>{kicker}</Kicker>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted">
              {subtitle}
            </p>
          )}
        </div>
        <Panel className="p-6 sm:p-8">{children}</Panel>
      </div>
    </main>
  );
}

export function AuthAlert({
  variant,
  children,
}: {
  variant: "error" | "success";
  children: ReactNode;
}) {
  const styles =
    variant === "error"
      ? "border-red-400/30 bg-red-500/10 text-red-300"
      : "border-accent/30 bg-accent/10 text-accent";
  return (
    <p
      role={variant === "error" ? "alert" : "status"}
      className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${styles}`}
    >
      {children}
    </p>
  );
}
