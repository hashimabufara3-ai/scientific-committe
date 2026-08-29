"use client";

import Link from "next/link";
import { ArrowRightIcon } from "./icons";

export type StageItem = {
  id: string;
  title: string;
  categoryLabel: string;
  count: number;
  number: string;
};

export type StageStrings = {
  hint: string;
  filter: string;
  flip: string;
  back: string;
  open: string;
  of: string;
  prev: string;
  next: string;
};

export type StageCountStrings = {
  summary: string;
  summaries: string;
};

type CountStrings = Pick<StageCountStrings, "summary" | "summaries">;

function countPhrase(count: number, strings: CountStrings) {
  if (count <= 0) return `0 ${strings.summaries}`;
  return count === 1
    ? `1 ${strings.summary}`
    : `${count} ${strings.summaries}`;
}

export default function ResourceStage({
  items,
  strings,
  counts,
  lang,
}: {
  items: StageItem[];
  strings: StageStrings;
  counts: StageCountStrings;
  lang: string;
}) {
  if (items.length === 0) return null;

  return (
    <div className="relative">
      {/* Ambient glow + perspective floor + floating particles. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div className="stage-halo h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(45,212,191,0.22),rgba(45,212,191,0.05)_45%,transparent_72%)] blur-2xl" />
        <div className="stage-floor" />
      </div>

      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
      >
        <span
          className="stage-particle"
          style={{ left: "14%", top: "30%", width: 6, height: 6, animationDelay: "0s" }}
        />
        <span
          className="stage-particle"
          style={{ left: "82%", top: "24%", width: 5, height: 5, animationDelay: "1.4s" }}
        />
        <span
          className="stage-particle"
          style={{ left: "68%", top: "62%", width: 7, height: 7, animationDelay: "0.7s" }}
        />
        <span
          className="stage-particle"
          style={{ left: "22%", top: "70%", width: 4, height: 4, animationDelay: "2.1s" }}
        />
      </div>

      {/* Responsive subject grid. */}
      <ul
        role="list"
        className="relative grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        {items.map((item) => (
          <li key={item.id} className="h-full">
            <Link
              href={`/${lang}/summaries/${item.id}`}
              aria-label={item.title}
              className="group flex h-full flex-col rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-5 outline-none transition-[border-color,box-shadow,background] duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent hover:border-accent/50 hover:bg-white/[0.04] hover:shadow-[0_0_50px_rgba(45,212,191,0.18),0_24px_60px_rgba(0,0,0,0.55)]"
            >
              <span className="shrink-0 font-mono text-3xl font-semibold tracking-tight text-transparent bg-clip-text bg-gradient-to-b from-white/40 to-white/10">
                {item.number}
              </span>

              <h3
                dir="auto"
                className="mt-3 text-base font-semibold leading-snug text-foreground sm:text-lg [overflow-wrap:anywhere] [word-break:break-word]"
              >
                {item.title}
              </h3>

              <p className="mt-2 flex-1 text-sm text-muted">
                {countPhrase(item.count, counts)}
              </p>

              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent">
                {strings.open}
                <ArrowRightIcon className="h-4 w-4 rtl-flip transition-transform duration-300 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
