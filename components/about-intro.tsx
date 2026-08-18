"use client";

import { useRef } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";

const EASE: [number, number, number, number] = [0.21, 0.47, 0.32, 0.98];

type AboutIntroProps = {
  kicker: string;
  title: string;
};

/* SCENE 1 — cinematic introduction. The committee name emerges from the dark
   like the opening frame of a documentary: a slow breath of glow, the kicker
   settling in, then the title rising out of depth into place. As the student
   scrolls into the story, the whole frame recedes — scale shrinking, the
   section sinking back into the world — so the next chapter can approach. */
export default function AboutIntro({ kicker, title }: AboutIntroProps) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const p = useSpring(scrollYProgress, { stiffness: 90, damping: 24, mass: 0.8 });

  const opacity = useTransform(p, [0, 0.72], [1, 0]);
  const y = useTransform(p, [0, 1], [0, -70]);
  const z = useTransform(p, [0, 1], [0, -150]);
  const scale = useTransform(p, [0, 1], [1, 0.9]);

  if (reduce) {
    return (
      <section className="relative isolate flex min-h-[64svh] items-center justify-center overflow-hidden py-20 sm:py-28">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/8 blur-[130px]"
        />
        <div className="relative mx-auto max-w-3xl px-4 text-center">
          <p className="inline-flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.25em] text-accent">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 border border-accent/80"
            />
            {kicker}
          </p>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-foreground sm:text-6xl">
            {title}
          </h1>
        </div>
      </section>
    );
  }

  return (
    <section
      ref={ref}
      className="relative isolate flex min-h-[64svh] items-center justify-center overflow-hidden py-20 sm:py-28"
    >
      {/* Local atmosphere: a slow breath of light behind the heading. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[420px] w-[560px] rounded-full bg-accent/8 blur-[130px]"
        style={{ x: "-50%", y: "-50%" }}
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.6, ease: EASE }}
      />

      {/* The frame that recedes as the story begins. */}
      <motion.div
        className="relative mx-auto max-w-3xl px-4 text-center"
        style={{
          opacity,
          y,
          z,
          scale,
          transformPerspective: 1400,
          willChange: "transform, opacity",
        }}
      >
        <motion.p
          initial={{ opacity: 0, y: 12, filter: "blur(3px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.7, ease: EASE }}
          className="inline-flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.25em] text-accent"
        >
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 border border-accent/80"
          />
          {kicker}
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, z: -60, scale: 0.96, y: 26, filter: "blur(5px)" }}
          animate={{ opacity: 1, z: 0, scale: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
          style={{ transformPerspective: 1200 }}
          className="mt-5 text-4xl font-semibold tracking-tight text-foreground sm:text-6xl"
        >
          {title}
        </motion.h1>
      </motion.div>
    </section>
  );
}
