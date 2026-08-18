import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main-content" className="mx-auto flex max-w-6xl flex-1 flex-col items-center justify-center px-4 py-28 text-center sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
        404
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
        Page not found
        <span className="mt-3 block text-xl text-muted sm:text-2xl">
          الصفحة غير موجودة
        </span>
      </h1>
      <p className="mt-6 max-w-md text-base leading-relaxed text-muted">
        The page you are looking for does not exist or has been moved.{" "}
        <span className="block">
          الصفحة التي تبحث عنها غير موجودة أو تم نقلها.
        </span>
      </p>
      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <Link href="/en" className="btn-primary">
          Back to home
        </Link>
        <Link href="/ar" className="btn-ghost">
          العودة إلى الرئيسية
        </Link>
      </div>
    </main>
  );
}
