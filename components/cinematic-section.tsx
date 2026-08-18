"use client";

import { createContext, useContext, useRef, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import type { MotionValue } from "motion/react";

/* -------------------------------------------------------------------- */
/* Scene context                                                        */
/* -------------------------------------------------------------------- */

type SceneContextValue = { progress: MotionValue<number> };

const SceneContext = createContext<SceneContextValue | null>(null);

/* Nested elements (e.g. Reveal cards) read the scene's camera progress so
   they can add their own subtle parallax instead of stacking a second,
   independent reveal animation on top of the camera move. */
export function useScene() {
  return useContext(SceneContext);
}

/* Coarse pointers get a reduced effect. The cursor-based interactions already
   gate on (hover: hover) and (pointer: fine); this shrinks the scroll-linked
   motion for touch as well. Subscribed via useSyncExternalStore so there is
   no per-frame state and no cascading setState. */
export function useCoarse() {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mq = window.matchMedia("(pointer: coarse)");
      const onMqChange = () => onChange();
      mq.addEventListener("change", onMqChange);
      return () => mq.removeEventListener("change", onMqChange);
    },
    () => {
      if (typeof window === "undefined" || !window.matchMedia) return false;
      return window.matchMedia("(pointer: coarse)").matches;
    },
    () => false
  );
}

/* -------------------------------------------------------------------- */
/* Camera choreography                                                  */
/* -------------------------------------------------------------------- */

/* Progress keyframes shared by every scene: arrive (0 -> 0.42), dwell
   (0.42 -> 0.58), recede (0.58 -> 1). The mapping is a pure function of
   scroll progress, so scrolling up reverses the exact cinematic
   relationship naturally - nothing is hard-coded to one direction. */

export const KP = [0, 0.42, 0.58, 1];

type CameraVariant = {
  offset: "journey" | "hero";
  scale: number[];
  opacity: number[];
  y: number[];
  z: number[];
  blur: number[];
  rotateX: number[];
};

export const CAMERA: Record<string, CameraVariant> = {
  /* Opening scene: the strongest depth move. Full presence at the top, then
     the whole scene sinks away from the camera as the pillars approach. */
  hero: {
    offset: "hero",
    scale: [1, 1, 0.93, 0.85],
    opacity: [1, 1, 0.5, 0.12],
    y: [0, 0, -46, -120],
    z: [0, 0, -70, -140],
    blur: [0, 0, 1.5, 6],
    rotateX: [0, 0, -1.5, -4],
  },
  /* Standard scene: strong arrival from depth, calm dwell, gentle recede. */
  default: {
    offset: "journey",
    scale: [0.9, 1, 1, 0.9],
    opacity: [0.35, 1, 1, 0.35],
    y: [58, 0, 0, -64],
    z: [-55, 0, 0, -90],
    blur: [4.5, 0, 0, 4],
    rotateX: [2.5, 0, 0, -2.5],
  },
  /* Slower scene: content drifts forward more gently (community). */
  soft: {
    offset: "journey",
    scale: [0.945, 1, 1, 0.955],
    opacity: [0.55, 1, 1, 0.6],
    y: [40, 0, 0, -42],
    z: [-38, 0, 0, -52],
    blur: [3, 0, 0, 2],
    rotateX: [1.5, 0, 0, -1.5],
  },
  /* Conclusion: slow, calm arrival and a soft exit into the footer. */
  calm: {
    offset: "journey",
    scale: [0.965, 1, 1, 0.97],
    opacity: [0.75, 1, 1, 0.8],
    y: [26, 0, 0, -28],
    z: [-26, 0, 0, -30],
    blur: [1.5, 0, 0, 1.5],
    rotateX: [0.75, 0, 0, -0.75],
  },
};

export const SPRING = { stiffness: 110, damping: 26, mass: 0.9 };

/* -------------------------------------------------------------------- */
/* Component                                                            */
/* -------------------------------------------------------------------- */

export default function CinematicSection({
  children,
  className = "",
  variant = "default",
  glow = true,
}: {
  children: ReactNode;
  className?: string;
  variant?: keyof typeof CAMERA;
  glow?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const coarse = useCoarse();
  const v = CAMERA[variant] ?? CAMERA.default;

  const { scrollYProgress } = useScroll({
    target: ref,
    offset:
      v.offset === "hero"
        ? ["start start", "end start"]
        : ["start end", "end start"],
  });

  /* The camera glides on a spring so it trails slightly behind the finger
     instead of snapping - that lag is what sells the dolly feel. */
  const p = useSpring(scrollYProgress, SPRING);

  /* Touch: reduce the travel while keeping the same timing and feel. */
  const f = coarse ? 0.45 : 1;

  const scale = useTransform(p, KP, v.scale.map((s) => 1 + (s - 1) * f));
  const opacity = useTransform(
    p,
    KP,
    v.opacity.map((o) => o + (1 - o) * (1 - f))
  );
  const y = useTransform(useTransform(p, KP, v.y), (n) => n * f);
  const z = useTransform(useTransform(p, KP, v.z), (n) => n * f);
  const rotateX = useTransform(useTransform(p, KP, v.rotateX), (n) => n * f);

  /* Local atmospheric glow, tied to the same camera so it fades as the
     scene recedes. */
  const glowOpacity = useTransform(p, KP, [0, 0.6, 0.6, 0]);
  const glowY = useTransform(p, [0, 1], [8, -8]);

  if (reduce) {
    return (
      <div ref={ref} className={`relative ${className}`}>
        {children}
      </div>
    );
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <SceneContext.Provider value={{ progress: p }}>
        <motion.div
          className="relative"
          style={{
            scale,
            opacity,
            y,
            z,
            rotateX,
            transformPerspective: 1400,
            /* transform/opacity only — a scroll-driven filter blur on this
               full-section wrapper re-rasterises the subtree every frame
               and stalls iOS Safari. */
            willChange: "transform, opacity",
          }}
        >
          {glow && (
            <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 -top-24 z-0 flex justify-center"
              style={{ y: glowY, opacity: glowOpacity }}
            >
              <div className="h-56 w-[78%] max-w-4xl rounded-full bg-accent/6 blur-[120px]" />
            </motion.div>
          )}
          <div className="relative z-10">{children}</div>
        </motion.div>
      </SceneContext.Provider>
    </div>
  );
}
