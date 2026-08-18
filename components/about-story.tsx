"use client";

import { useRef } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";

type AboutStoryProps = {
  line: string;
};

/* SCENE 2 — story discovery. The turn of the first chapter: the intro frame
   has receded and this single line — who we are — approaches the viewer out
   of the dark, holds briefly, then yields to the chapters ahead. Depth is
   tied to scroll progress, so the passage reads as one continuous motion
   rather than a stack of reveals. */
export default function AboutStory({ line }: AboutStoryProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const p = useSpring(scrollYProgress, { stiffness: 90, damping: 26, mass: 0.8 });

  const opacity = useTransform(p, [0, 0.3, 0.7, 1], [0, 1, 1, 0]);
  const y = useTransform(p, [0, 0.3, 0.7, 1], [56, 0, 0, -56]);
  const z = useTransform(p, [0, 0.3, 0.7, 1], [-90, 0, 0, -90]);
  const scale = useTransform(p, [0, 0.3, 0.7, 1], [0.95, 1, 1, 0.95]);
  const glowOpacity = useTransform(p, [0, 0.4, 0.6, 1], [0, 0.7, 0.7, 0]);

  if (reduce) {
    return (
      <div
        ref={ref}
        className="relative flex items-center justify-center py-20 sm:py-24"
      >
        <p className="mx-auto max-w-2xl px-4 text-center text-lg leading-relaxed text-muted sm:text-xl">
          {line}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="relative isolate flex items-center justify-center overflow-hidden py-20 sm:py-24"
    >
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[320px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/6 blur-[120px]"
        style={{ opacity: glowOpacity }}
      />
      <motion.div
        className="relative mx-auto max-w-2xl px-4 text-center"
        style={{
          opacity,
          y,
          z,
          scale,
          transformPerspective: 1200,
          willChange: "transform, opacity",
        }}
      >
        <p className="text-lg leading-relaxed text-muted sm:text-xl">{line}</p>
      </motion.div>
    </div>
  );
}
