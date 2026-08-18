"use client";

import { useCallback, useRef } from "react";
import type { PointerEvent } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import type { MotionValue } from "motion/react";

/* Decorative accent layer of the immersive hero grid: illuminated nodes,
   connection lines, a signal pulse, technical labels, a perspective floor
   and a slow scanning light. The base fine grid + radial fade live in CSS
   (.tg-lines / .tg-fade). Lightweight: one small SVG, no canvas, no filters. */

type Node = { x: number; y: number; delay: number; extra?: boolean };

/* Coordinates are multiples of the 32px grid cell so the accents sit near
   grid intersections. */
const NODES: Node[] = [
  { x: 96, y: 128, delay: 0 },
  { x: 384, y: 84, delay: 0.7 },
  { x: 672, y: 132, delay: 1.4 },
  { x: 960, y: 92, delay: 2.1 },
  { x: 1248, y: 156, delay: 2.8 },
  { x: 224, y: 344, delay: 3.5 },
  { x: 1216, y: 424, delay: 4.2 },
  { x: 736, y: 560, delay: 4.9, extra: true },
  { x: 512, y: 664, delay: 5.6, extra: true },
  { x: 1088, y: 700, delay: 6.3, extra: true },
];

/* Node index pairs to connect. */
const LINKS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [1, 5],
  [3, 6],
  [5, 7],
  [6, 8],
];

/* Path the signal pulse travels along (node 1 → 2 → 3). */
const PULSE_PATH = "M 384 84 L 672 132 L 960 92";

export default function TechnicalGrid({
  className = "",
  parallaxX,
  parallaxY,
}: {
  className?: string;
  parallaxX?: MotionValue<number>;
  parallaxY?: MotionValue<number>;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: canvasRef,
    offset: ["start start", "end start"],
  });
  const gridOpacity = useTransform(scrollYProgress, [0, 1], [1, 0.4]);
  const floorShift = useTransform(scrollYProgress, [0, 1], ["0%", "-10%"]);

  const onMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const el = pointerRef.current;
      const canvas = canvasRef.current;
      if (!el || !canvas || reduce) return;
      if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
      const rect = canvas.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
      el.style.setProperty("--my", `${e.clientY - rect.top}px`);
      el.classList.add("tg-pointer-on");
    },
    [reduce]
  );

  const onLeave = useCallback(() => {
    if (reduce) return;
    pointerRef.current?.classList.remove("tg-pointer-on");
  }, [reduce]);

  const svg = (
    <svg
      className="absolute inset-0 h-full w-full font-mono"
      style={{ direction: "ltr" }}
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {/* Connection lines */}
      <g
        stroke="#22d3ee"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
        fill="none"
        opacity="0.28"
      >
        {LINKS.map(([a, b]) => {
          const from = NODES[a];
          const to = NODES[b];
          return (
            <line
              key={`${a}-${b}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
            />
          );
        })}
      </g>

      {/* Illuminated nodes: breathing halo + static core */}
      <g>
        {NODES.map((n, i) => (
          <g key={i} className={n.extra ? "tg-node-extra" : undefined}>
            <circle
              cx={n.x}
              cy={n.y}
              r="6"
              fill="#2dd4bf"
              opacity="0.14"
              className="tg-node-anim tg-anim"
              style={{ animationDelay: `${n.delay}s` }}
            />
            <circle cx={n.x} cy={n.y} r="1.6" fill="#2dd4bf" />
          </g>
        ))}
      </g>

      {/* Signal pulse along a connection line */}
      <circle
        r="2.2"
        fill="#67e8f9"
        className="tg-path-pulse tg-anim"
        style={{
          offsetPath: `path("${PULSE_PATH}")`,
          offsetRotate: "0deg",
        }}
      />

      {/* Technical coordinates / labels */}
      <g className="tg-label" fill="#9aa3b2" fontSize="12" letterSpacing="1">
        <text x={40} y={44}>
          AL-AROUB BRANCH // PTUK-K
        </text>
        <text x={40} y={62} opacity={0.65} fontSize={11}>
          31.6196° N · 35.1367° E
        </text>
        <text
          x={1400}
          y={44}
          textAnchor="end"
          fill="#22d3ee"
          opacity={0.85}
        >
          SCIENTIFIC COMMITTEE
        </text>
        <text x={1400} y={62} textAnchor="end" opacity={0.65} fontSize={11}>
          SYS.03 // ONLINE
        </text>
        <text x={40} y={856} opacity={0.65} fontSize={11}>
          X:0421 · Y:0873
        </text>
        <text x={1400} y={856} textAnchor="end" opacity={0.65} fontSize={11}>
          GRID 32MM // SCALE 1:1
        </text>
      </g>
    </svg>
  );

  const staticCanvas = (
    <div className="absolute inset-0">
      <div className="tg-lines tg-fade" aria-hidden="true" />
      <div className="tg-floor" aria-hidden="true" />
      {svg}
    </div>
  );

  return (
    <div
      ref={canvasRef}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={`tg-canvas ${className}`}
    >
      {reduce ? (
        staticCanvas
      ) : (
        <motion.div
          className="absolute inset-0"
          style={{
            opacity: gridOpacity,
            x: parallaxX,
            y: parallaxY,
            z: -140,
            scale: 1.08,
            transformPerspective: 1400,
          }}
        >
          <div className="tg-lines tg-fade" aria-hidden="true" />
          <motion.div
            className="tg-floor"
            aria-hidden="true"
            style={{ y: floorShift }}
          />
          {svg}
          <div className="tg-scan tg-anim" aria-hidden="true" />
          <div ref={pointerRef} className="tg-pointer" aria-hidden="true" />
        </motion.div>
      )}
    </div>
  );
}
