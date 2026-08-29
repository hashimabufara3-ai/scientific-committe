"use client";

import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { CAMERA, KP, SPRING, useCoarse } from "./cinematic-section";
import TechnicalGrid from "./technical-grid";
import StatCounters from "./stat-counters";
import { ArrowRightIcon, ChevronDownIcon } from "./icons";

const REVEAL_EASE: [number, number, number, number] = [0.21, 0.47, 0.32, 0.98];

type HeroCopy = {
  kicker: string;
  titleA: string;
  titleHighlight: string;
  subtitle: string;
  ctaPrimary: string;
  ctaSecondary: string;
  scroll: string;
};

type HeroStats = { value: string; label: string }[];

type Props = {
  hero: HeroCopy;
  stats: HeroStats;
  lang: string;
};

/* The Home hero: one cinematic camera scene built on the exact same physics
   as CinematicSection (shared KP / SPRING / CAMERA.hero). Layers, from the
   back: technical grid -> atmospheric fog (parallax + depth blur) -> the
   Remotion-rendered logo video (its own fog/glow background matches the
   page tokens, so the emblem floats in the environment) -> a pointer-driven
   ambient light -> readability scrim -> live DOM content.

   Pointer response is spring-smoothed MotionValues only - no React state on
   the pointer path. Scroll response is one springed progress value shared by
   every layer, so the whole hero recedes like a physical camera pull.

   The logo video is decorative and preserved exactly: the artwork is never
   touched, we only transform its container (same rule the Remotion
   composition itself follows). Reduced motion swaps the video for the static
   poster and removes all parallax/camera movement. Coarse pointers keep the
   scroll camera (scaled down) but drop pointer-follow effects. */

export default function HeroCinematic({ hero, stats, lang }: Props) {
  const reduce = useReducedMotion();
  const coarse = useCoarse();
  const enabled = !reduce && !coarse;
  const sectionRef = useRef<HTMLElement>(null);

  /* ---- Scroll camera: same spring + keyframes as CinematicSection.hero ---- */
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const p = useSpring(scrollYProgress, SPRING);
  const f = coarse ? 0.45 : 1;
  const v = CAMERA.hero;

  const scale = useTransform(p, KP, v.scale.map((s) => 1 + (s - 1) * f));
  const opacity = useTransform(
    p,
    KP,
    v.opacity.map((o) => o + (1 - o) * (1 - f))
  );
  const y = useTransform(useTransform(p, KP, v.y), (n) => n * f);
  const z = useTransform(useTransform(p, KP, v.z), (n) => n * f);
  const rotateX = useTransform(useTransform(p, KP, v.rotateX), (n) => n * f);

  /* ---- Pointer environment (springs, no state) ---- */
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const smoothX = useSpring(px, { stiffness: 60, damping: 20, mass: 1 });
  const smoothY = useSpring(py, { stiffness: 60, damping: 20, mass: 1 });

  /* Layer 1 - background atmosphere, very subtle. */
  const bgX = useTransform(smoothX, [0, 1], [6, -6]);
  const bgY = useTransform(smoothY, [0, 1], [4, -4]);

  /* Layer 2 - glow/light field, moderate response. */
  const glowX = useTransform(smoothX, [0, 1], [22, -22]);
  const glowY = useTransform(smoothY, [0, 1], [16, -16]);

  /* Layer 3 - logo/video environment, subtle depth. */
  const videoX = useTransform(smoothX, [0, 1], [9, -9]);
  const videoY = useTransform(smoothY, [0, 1], [6, -6]);

  /* Layer 4 - headline/content, slightly stronger. */
  const contentX = useTransform(smoothX, [0, 1], [13, -13]);
  const contentY = useTransform(smoothY, [0, 1], [9, -9]);

  /* Layer 5 - interactive controls, very subtle. */
  const ctlX = useTransform(smoothX, [0, 1], [4, -4]);
  const ctlY = useTransform(smoothY, [0, 1], [3, -3]);

  /* Interactive ambient light follows the pointer through the scene. */
  const lightX = useTransform(smoothX, [0, 1], ["18%", "82%"]);
  const lightY = useTransform(smoothY, [0, 1], ["18%", "82%"]);
  const light = useMotionTemplate`radial-gradient(560px circle at ${lightX} ${lightY}, rgb(45 212 191 / 0.13), rgb(34 211 238 / 0.05) 45%, transparent 70%)`;

  /* Headline micro-tilt toward the pointer (independent of the scene rig). */
  const hlX = useMotionValue(0.5);
  const hlY = useMotionValue(0.5);
  const hlSpring = { stiffness: 180, damping: 22, mass: 0.6 };
  const headlineRotateX = useSpring(useTransform(hlY, [0, 1], [3, -3]), hlSpring);
  const headlineRotateY = useSpring(useTransform(hlX, [0, 1], [-6, 6]), hlSpring);

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!enabled) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    px.set((e.clientX - rect.left) / rect.width);
    py.set((e.clientY - rect.top) / rect.height);
  };

  const onPointerLeave = () => {
    if (!enabled) return;
    px.set(0.5);
    py.set(0.5);
  };

  const onHeadlineMove = (e: ReactPointerEvent<HTMLHeadingElement>) => {
    if (!enabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    hlX.set((e.clientX - rect.left) / rect.width);
    hlY.set((e.clientY - rect.top) / rect.height);
  };

  const onHeadlineLeave = () => {
    if (!enabled) return;
    hlX.set(0.5);
    hlY.set(0.5);
  };

  /* ---- Decorative environment layers ---- */
  const atmosphere = (
    <div aria-hidden="true" className="absolute inset-0">
      {/* Layer 1: faint grid canvas (reuses the site's technical-grid system). */}
      <TechnicalGrid
        className="absolute inset-0"
        parallaxX={enabled ? bgX : undefined}
        parallaxY={enabled ? bgY : undefined}
      />

      {/* Layer 2: fog + glow field, parallaxed (transform-only). No scroll
          filter blur here — blur on this full-viewport layer re-rasterises
          every scroll frame and stalls iOS. */}
      <motion.div
        className="absolute inset-0"
        style={{
          x: enabled ? glowX : undefined,
          y: enabled ? glowY : undefined,
          willChange: "transform",
        }}
      >
        <div className="hero-fog absolute inset-0" />
        <div className="absolute left-1/2 top-[6%] h-[68vh] w-[120vw] -translate-x-1/2 rounded-full bg-accent/7 blur-[130px]" />
        <div className="absolute -start-[12%] top-[34%] h-[58vh] w-[58vh] rounded-full bg-accent-bright/6 blur-[120px]" />
        <div className="absolute -end-[10%] bottom-[6%] h-[50vh] w-[50vh] rounded-full bg-amber/5 blur-[120px]" />
      </motion.div>

      {/* Interactive pointer light above the video, below the text. */}
      {enabled && (
        <motion.div
          className="pointer-events-none absolute inset-0 mix-blend-screen"
          style={{ background: light }}
        />
      )}

      {/* Readability scrims that ground the text. */}
      <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-ink/85 to-transparent" />
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-ink/60 to-transparent" />
    </div>
  );

  /* ---- Logo centerpiece: a static frame extracted from the Remotion hero
     video (hero-frame.webp) instead of streaming the ~7.5 MB hero.mp4. Same
     composition, aspect and parallax — just a lightweight image. ---- */
  const logoVideo = (
    <motion.div
      aria-hidden="true"
      className="relative mx-auto aspect-video h-[clamp(150px,25svh,260px)] w-auto max-w-full"
      style={{ x: enabled ? videoX : undefined, y: enabled ? videoY : undefined }}
    >
      <Image
        src="/video/hero-frame.webp"
        alt=""
        fill
        priority
        sizes="(max-width: 640px) 70vw, 460px"
        className="rounded-3xl object-contain"
      />
    </motion.div>
  );

  /* ---- Live DOM foreground ---- */
  const content = (
    <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center px-4 pb-12 pt-10 sm:px-6">
      <motion.div
        className="flex flex-col items-center"
        style={{ x: enabled ? contentX : undefined, y: enabled ? contentY : undefined }}
      >
        {logoVideo}

        <p className="mt-5 text-center font-mono text-[11px] font-medium uppercase tracking-[0.3em] text-muted sm:text-xs">
          {hero.kicker}
        </p>

        <motion.h1
          onPointerMove={onHeadlineMove}
          onPointerLeave={onHeadlineLeave}
          className="relative mt-3 max-w-3xl text-center text-3xl font-semibold leading-[1.12] tracking-tight text-foreground sm:text-4xl md:text-5xl"
          style={{
            rotateX: enabled ? headlineRotateX : 0,
            rotateY: enabled ? headlineRotateY : 0,
            transformPerspective: 900,
          }}
        >
          {hero.titleA}{" "}
          <span className="bg-gradient-to-r from-accent-bright to-accent bg-clip-text text-transparent">
            {hero.titleHighlight}
          </span>
        </motion.h1>

        <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed text-muted sm:text-base">
          {hero.subtitle}
        </p>

        <motion.div
          className="mt-6 flex flex-wrap items-center justify-center gap-3"
          style={{ x: enabled ? ctlX : undefined, y: enabled ? ctlY : undefined }}
        >
          <Link href={`/${lang}/summaries`} className="btn-primary">
            {hero.ctaPrimary}
            <ArrowRightIcon className="h-4 w-4 rtl-flip" />
          </Link>
          <Link href={`/${lang}/contact`} className="btn-ghost">
            {hero.ctaSecondary}
          </Link>
        </motion.div>

        <dl
          className={`mt-6 grid gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 ${
            stats.length >= 3
              ? "max-w-3xl grid-cols-2 sm:grid-cols-3"
              : stats.length === 2
                ? "mx-auto max-w-xl grid-cols-2"
                : "mx-auto max-w-md grid-cols-1"
          }`}
        >
          <StatCounters stats={stats} />
        </dl>

        <a
          href="#pillars"
          className="mt-5 inline-flex flex-col items-center gap-1.5 text-sm text-muted transition-colors hover:text-accent"
        >
          {hero.scroll}
          <ChevronDownIcon className="hero-cue h-4 w-4" />
        </a>
      </motion.div>
    </div>
  );

  return (
    <section
      ref={sectionRef}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onContextMenu={(e) => e.preventDefault()}
      className="relative flex min-h-svh flex-col overflow-hidden bg-ink"
    >
      <motion.div
        className="relative flex flex-1 flex-col"
        style={
          reduce
            ? undefined
            : {
                scale,
                opacity,
                y,
                z,
                rotateX,
                transformPerspective: 1400,
                willChange: "transform, opacity",
              }
        }
      >
        {atmosphere}
        {content}
      </motion.div>
    </section>
  );
}
