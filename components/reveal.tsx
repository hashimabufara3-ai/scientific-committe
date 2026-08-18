"use client";

import { Children, cloneElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { useCoarse, useScene } from "./cinematic-section";

/* Depth-based entrance shared by content outside the Home camera scenes
   (other pages). Inside a CinematicSection it switches role: instead of
   stacking a second reveal on top of the camera move, each element adds a
   small parallax whose depth grows with its stagger index - so cards within
   a scene travel at slightly different depths rather than as a flat sheet.

   Outside a scene, content renders statically: the whole-page entrance now
   lives on the layout's main-content wrapper (a single fade + blur + rise
   that plays once on the initial page load), so individual elements no
   longer reveal on their own. Reduced motion and coarse pointers already
   collapse the scroll-linked motion in the scene branch. */

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
};

export default function Reveal({
  children,
  className,
  delay = 0,
}: RevealProps) {
  const reduce = useReducedMotion();
  const scene = useScene();
  const coarse = useCoarse();

  const f = coarse ? 0.4 : 1;
  const ampY = (4 + delay * 30) * f;
  const ampZ = delay * 44 * f;

  const idle = useMotionValue(0.5);
  const p = scene?.progress ?? idle;

  const y = useTransform(p, [0, 0.42, 0.58, 1], [ampY, 0, 0, -ampY]);
  const z = useTransform(p, [0, 0.42, 0.58, 1], [-ampZ, 0, 0, ampZ]);

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  /* Standalone usage (non-Home pages): content renders statically. The
     whole-page entrance on the layout's main-content wrapper handles the
     cinematic entry, so individual elements no longer reveal on their own. */
  if (!scene) {
    return <div className={className}>{children}</div>;
  }

  /* Inside a camera scene: per-item parallax, no independent reveal. */
  return (
    <motion.div
      className={className}
      style={{ y, z, transformPerspective: 1000, willChange: "transform" }}
    >
      {children}
    </motion.div>
  );
}

/* Stagger helper: assigns each child a progressive delay slot (120ms apart
   by default). Standalone Reveal renders statically, so the delays only
   matter inside a CinematicSection, where they control the depth parallax
   spread between cards. No wrapper element is added, so grid/flex layouts
   are untouched. */
export function RevealGroup({
  children,
  delay = 0,
  step = 0.12,
}: {
  children: ReactNode;
  delay?: number;
  step?: number;
}) {
  const items = Children.toArray(children).filter(
    (child): child is ReactElement<{ delay?: number }> =>
      isValidElement(child)
  );
  return (
    <>
      {items.map((child, index) =>
        cloneElement(child, {
          delay: delay + index * step + (child.props.delay ?? 0),
        })
      )}
    </>
  );
}
