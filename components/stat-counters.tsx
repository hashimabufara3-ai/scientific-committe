"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useInView, useReducedMotion } from "motion/react";

type Stat = { value: string; label: string };

/* Cinematic count-up for the hero statistics. Each number eases from 0 to its
   real target (keeping the "+" prefix visible, e.g. "+31") once when the block
   scrolls into view, staggered slightly. Runs a single time per page visit
   and ends exactly at the real value; under prefers-reduced-motion it shows
   the final value immediately. */

const EASE: [number, number, number, number] = [0.21, 0.47, 0.32, 0.98];
const DURATION = 1.8;
const STAGGER = 0.12;

/* The value is a string like "+31": a leading visual prefix (usually "+"),
   then the real number (the source of truth), then an optional trailing
   suffix. Only the number animates; the prefix stays visible throughout. */
function parseValue(value: string) {
  const match = value.match(/^(\D*)(\d+)(.*)$/);
  return {
    prefix: match?.[1] ?? "",
    target: Number(match?.[2] ?? 0),
    suffix: match?.[3] ?? "",
  };
}

function CountUp({ value, delay }: { value: string; delay: number }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const { prefix, target, suffix } = parseValue(value);
  const [display, setDisplay] = useState(`${prefix}0${suffix}`);

  useEffect(() => {
    if (reduce || !inView) return;

    const controls = animate(0, target, {
      duration: DURATION,
      delay,
      ease: EASE,
      onUpdate: (v) => setDisplay(`${prefix}${Math.round(v)}${suffix}`),
      onComplete: () => setDisplay(value),
    });
    return () => controls.stop();
  }, [inView, reduce, value, prefix, target, suffix, delay]);

  /* dir="ltr" keeps the "+" visually BEFORE the number even when the
     surrounding page is right-to-left (Arabic), where bidirectional text
     rendering would otherwise flip it to "31+". */
  return (
    <span dir="ltr" ref={ref}>
      {reduce ? value : display}
    </span>
  );
}

export default function StatCounters({ stats }: { stats: Stat[] }) {
  return stats.map((stat, i) => (
    <div
      key={stat.label}
      className="bg-ink/70 px-6 py-6 text-center backdrop-blur"
    >
      <dt className="font-mono text-3xl font-semibold tracking-tight text-foreground">
        <CountUp value={stat.value} delay={i * STAGGER} />
      </dt>
      <dd className="mt-1 text-sm text-muted">{stat.label}</dd>
    </div>
  ));
}
