import Image from "next/image";
import Link from "next/link";

export function Logo({ href, name, subtitle }: { href: string; name: string; subtitle: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg py-1"
      aria-label={name}
    >
      <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-xl bg-[#020A17] shadow-[0_2px_12px_rgba(0,0,0,0.45)] ring-1 ring-white/10">
        <Image
          src="/images/scientific-committee-logo.jpg"
          alt=""
          fill
          sizes="36px"
          className="object-contain"
        />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold text-foreground">{name}</span>
        <span className="text-[11px] text-muted">{subtitle}</span>
      </span>
    </Link>
  );
}
