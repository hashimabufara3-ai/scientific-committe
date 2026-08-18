"use client";

import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";

/* Persistent atmosphere behind the whole page. The technical grid (rendered
   by the layout) is the rearmost, static layer; these fixed glows drift
   slowly with the camera so the world keeps breathing between scenes. Fixed
   layers never reset, so the Home page reads as one continuous environment
   instead of stacked sections. Reduced motion keeps a calm static version. */

export default function WorldBackdrop() {
  const reduce = useReducedMotion();

  const { scrollYProgress } = useScroll();
  const p = useSpring(scrollYProgress, { stiffness: 90, damping: 24, mass: 0.8 });

  const glowA = useTransform(p, [0, 1], [0, -200]);
  const glowB = useTransform(p, [0, 1], [0, -130]);
  const glowC = useTransform(p, [0, 1], [0, -280]);

  if (reduce) {
    return (
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute left-1/2 top-[-12%] h-[560px] w-[680px] -translate-x-1/2 rounded-full bg-accent/8 blur-[150px]" />
        <div className="absolute right-[-10%] top-[36%] h-[480px] w-[480px] rounded-full bg-accent-bright/6 blur-[140px]" />
        <div className="absolute bottom-[-10%] left-[-8%] h-[440px] w-[440px] rounded-full bg-amber/5 blur-[140px]" />
      </div>
    );
  }

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0">
      <motion.div
        className="absolute left-1/2 top-[-12%] h-[560px] w-[680px] rounded-full bg-accent/8 blur-[150px]"
        style={{ x: "-50%", y: glowA, willChange: "transform" }}
      />
      <motion.div
        className="absolute right-[-10%] top-[36%] h-[480px] w-[480px] rounded-full bg-accent-bright/6 blur-[140px]"
        style={{ y: glowB, willChange: "transform" }}
      />
      <motion.div
        className="absolute bottom-[-10%] left-[-8%] h-[440px] w-[440px] rounded-full bg-amber/5 blur-[140px]"
        style={{ y: glowC, willChange: "transform" }}
      />
    </div>
  );
}
