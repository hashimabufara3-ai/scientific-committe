"use client";

import { useRef } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import type { ReactNode } from "react";
import Card from "./card";

const EASE: [number, number, number, number] = [0.21, 0.47, 0.32, 0.98];

type AboutPanelProps = {
  children: ReactNode;
  /* "chapter" ties depth to scroll progress: the panel arrives from a
     distance, dwells, and recedes as the next chapter approaches. "discover"
     is the lighter entrance used when panels are revealed sequentially. */
  variant?: "chapter" | "discover";
  depth?: number;
  /* How far behind the viewer the panel starts, before settling. A larger
     value makes the panel feel further away, so chapters relate to each
     other without moving identically. */
  enterDepth?: number;
  delay?: number;
  className?: string;
  cardClassName?: string;
};

export default function AboutPanel({
  children,
  variant = "discover",
  depth = 0,
  enterDepth = 40,
  delay = 0,
  className = "",
  cardClassName = "",
}: AboutPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const p = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 26,
    mass: 0.7,
  });

  const inner = <Card className={cardClassName}>{children}</Card>;

  const opacity = useTransform(p, [0, 0.3, 0.7, 1], [0, 1, 1, 0.2]);
  const y = useTransform(p, [0, 0.3, 0.7, 1], [48, 0, 0, -48]);
  const z = useTransform(p, [0, 0.3, 0.7, 1], [-enterDepth, depth, depth, -enterDepth]);
  const scale = useTransform(p, [0, 0.3, 0.7, 1], [0.95, 1, 1, 0.95]);

  if (reduce) {
    return (
      <div ref={ref} className={className}>
        {inner}
      </div>
    );
  }

  if (variant === "chapter") {
    return (
      <motion.div
        ref={ref}
        className={className}
        style={{
          opacity,
          y,
          z,
          scale,
          transformPerspective: 1100,
          willChange: "transform, opacity",
        }}
      >
        {inner}
      </motion.div>
    );
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, z: depth - 60, scale: 0.94, y: 24 }}
      whileInView={{ opacity: 1, z: depth, scale: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.75, delay, ease: EASE }}
      style={{ transformPerspective: 1000 }}
    >
      {inner}
    </motion.div>
  );
}
