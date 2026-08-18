"use client";

import Link from "next/link";
import { useCallback } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";

const MotionLink = motion.create(Link);

type CardProps = {
  children: ReactNode;
  href?: string;
  className?: string;
};

/* Technical panel with a subtle 3D presence: the whole card tilts toward the
   cursor, lifts off the page on hover, and a cursor-following light sweeps
   across the surface. Mouse tracking runs on motion values + springs (no
   React state per frame) and is disabled for reduced motion and touch. */
const MAX_TILT = 7;

export default function Card({
  children,
  href,
  className = "",
}: CardProps) {
  const reduce = useReducedMotion();

  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);

  const spring = { stiffness: 220, damping: 24, mass: 0.6 };
  const rotateX = useSpring(
    useTransform(py, [0, 1], [MAX_TILT, -MAX_TILT]),
    spring
  );
  const rotateY = useSpring(
    useTransform(px, [0, 1], [-MAX_TILT, MAX_TILT]),
    spring
  );

  const sheenX = useTransform(px, [0, 1], ["15%", "85%"]);
  const sheenY = useTransform(py, [0, 1], ["15%", "85%"]);
  const sheen = useMotionTemplate`radial-gradient(
    300px circle at ${sheenX} ${sheenY},
    rgb(103 232 249 / 0.16),
    transparent 70%
  )`;

  const onMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (reduce) return;
      if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches)
        return;
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      px.set((e.clientX - rect.left) / rect.width);
      py.set((e.clientY - rect.top) / rect.height);
    },
    [reduce, px, py]
  );

  const onLeave = useCallback(() => {
    if (reduce) return;
    px.set(0.5);
    py.set(0.5);
  }, [reduce, px, py]);

  const base =
    "group relative block rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-sm transition-colors duration-300 motion-safe:hover:border-accent/40 motion-safe:hover:bg-white/[0.05]";

  const corners = (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <span className="absolute left-0 top-0 h-3.5 w-3.5 border-l border-t border-accent/60 opacity-50 transition-opacity duration-300 group-hover:opacity-100" />
      <span className="absolute right-0 top-0 h-3.5 w-3.5 border-r border-t border-accent/60 opacity-50 transition-opacity duration-300 group-hover:opacity-100" />
      <span className="absolute bottom-0 left-0 h-3.5 w-3.5 border-b border-l border-accent/60 opacity-50 transition-opacity duration-300 group-hover:opacity-100" />
      <span className="absolute bottom-0 right-0 h-3.5 w-3.5 border-b border-r border-accent/60 opacity-50 transition-opacity duration-300 group-hover:opacity-100" />
    </span>
  );

  const sheenLayer = (
    <motion.span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-xl opacity-0 mix-blend-screen transition-opacity duration-300 group-hover:opacity-100"
      style={{ background: sheen }}
    />
  );

  const motionProps = {
    className: `${base} ${className}`,
    style: {
      rotateX,
      rotateY,
      transformPerspective: 900,
      boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.05)",
    },
    whileHover: {
      y: -6,
      z: 26,
      boxShadow:
        "inset 0 1px 0 rgb(255 255 255 / 0.08), 0 24px 48px rgba(0, 0, 0, 0.45)",
    },
    onPointerMove: onMove,
    onPointerLeave: onLeave,
  };

  if (reduce) {
    const plainProps = {
      className: `${base} ${className}`,
      children: (
        <>
          {corners}
          {children}
        </>
      ),
    };
    return href ? (
      <Link href={href} {...plainProps} />
    ) : (
      <div {...plainProps} />
    );
  }

  return href ? (
    <MotionLink href={href} {...motionProps}>
      {sheenLayer}
      {corners}
      {children}
    </MotionLink>
  ) : (
    <motion.div {...motionProps}>
      {sheenLayer}
      {corners}
      {children}
    </motion.div>
  );
}
