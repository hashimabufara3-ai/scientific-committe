"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import { useCoarse } from "./cinematic-section";
import { ArrowRightIcon } from "./icons";

const EASE: [number, number, number, number] = [0.21, 0.47, 0.32, 0.98];
const DEPTH_SPRING = { stiffness: 300, damping: 30, mass: 0.7 };
const SETTLE_SPRING = { stiffness: 260, damping: 30, mass: 0.8 };

type Gender = "male" | "female";

type Member = { name: string; role: string; major: string; gender: Gender };

/* --------------------------------------------------------------------- */
/* Human figure geometry                                                 */
/* --------------------------------------------------------------------- */

/* Silhouettes are generated from a parametric body shape so the whole
   lineup shares one coherent, organic construction. A single continuous
   outline covers neck → shoulders → torso → hips → both legs → feet; the
   head and the tapered arms are drawn *behind* it so the torso covers
   every seam. A Catmull-Rom spline through the landmark points keeps every
   transition smooth and organic. Only the body-shape table differs between
   genders, so male/female figures stay proportional and subtle. */

const CENTER = 110; // horizontal centre of the 220 × 400 viewBox

/* Shared vertical landmarks (≈7.7 head-units tall). */
const FIGURE = {
  neckY: 52,      // top of the neck (tucks under the chin)
  shoulderY: 74,  // widest point of the shoulders
  armpitY: 92,    // just under the shoulder cap (deltoid / armpit)
  chestY: 112,    // upper torso volume (chest line)
  ribY: 140,      // lower ribs - keeps the taper organic, not a tube
  waistY: 162,    // narrowest point of the torso
  lowWaistY: 192, // just above the hip flare
  hipY: 216,      // widest point of the hips
  crotchY: 238,   // where the legs meet
  thighY: 264,    // mid thigh
  kneeY: 302,     // knee (legs narrow here, calves flare below)
  calfY: 344,     // widest point of the calf
  ankleY: 372,    // ankle
  floorY: 393,    // soles of the feet
};

type BodyShape = {
  neckW: number;     // half neck width
  shoulderW: number; // half shoulder width
  armpitW: number;   // half width just under the shoulder cap
  chestW: number;    // half chest width
  ribW: number;      // half lower-rib width
  waistW: number;    // half waist width
  lowWaistW: number; // half width just above the hips
  hipW: number;      // half hip width
  legIn: number;     // inner edge offset of each leg at the crotch
  legOut: number;    // inner edge offset of each leg at the floor (stance)
  thighW: number;    // full thigh width
  kneeW: number;     // full knee width
  calfW: number;     // full calf width
  ankleW: number;    // full ankle width
  footWing: number;  // how far the toe reaches past the outer ankle
  footIn: number;    // sole inner offset from centre
  armPivotY: number; // shoulder joint height
  upper: { top: number; mid: number; end: number; len: number };
  fore: { top: number; end: number; len: number };
  hand: { rx: number; ry: number };
  head: { cx: number; cy: number; rx: number; ry: number };
};

/* Male: broad shoulders, straight torso, hips narrower than the shoulders.
   Female: narrower shoulders, a more defined waist, hips close to the
   shoulder width. Both stay inside believable proportions - nothing is
   exaggerated. */
const SHAPES: Record<Gender, BodyShape> = {
  male: {
    neckW: 8.5,
    shoulderW: 33,
    armpitW: 29.5,
    chestW: 30.5,
    ribW: 24,
    waistW: 19.5,
    lowWaistW: 20.5,
    hipW: 22.5,
    legIn: 3.5,
    legOut: 9,
    thighW: 15,
    kneeW: 12.5,
    calfW: 13,
    ankleW: 9,
    footWing: 8,
    footIn: 5,
    armPivotY: 84,
    upper: { top: 12.5, mid: 15, end: 11, len: 56 },
    fore: { top: 11, end: 8.5, len: 50 },
    hand: { rx: 6.5, ry: 8.5 },
    head: { cx: 110, cy: 30, rx: 18.5, ry: 24 },
  },
  female: {
    neckW: 6.5,
    shoulderW: 26.5,
    armpitW: 24.5,
    chestW: 25,
    ribW: 20.5,
    waistW: 16.5,
    lowWaistW: 19,
    hipW: 25.5,
    legIn: 3.5,
    legOut: 8.5,
    thighW: 13.5,
    kneeW: 11.5,
    calfW: 12,
    ankleW: 8,
    footWing: 7,
    footIn: 5,
    armPivotY: 82,
    upper: { top: 10.5, mid: 12.5, end: 9.5, len: 53 },
    fore: { top: 9, end: 7, len: 47 },
    hand: { rx: 5.5, ry: 7.5 },
    head: { cx: 110, cy: 30, rx: 17.5, ry: 23 },
  },
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/* A single tapered limb segment (upper arm or forearm) in local coords,
   with the joint at (0,0) and the limb hanging down the +y axis. The sides
   bulge gently near the middle and both ends are rounded - an organic
   capsule, not a rectangle. */
function limbPath(len: number, wTop: number, wMid: number, wEnd: number): string {
  const t = wTop / 2;
  const m = wMid / 2;
  const e = wEnd / 2;
  const mid = len * 0.52;
  return [
    `M ${r2(-t)} 2`,
    `C ${r2(-t - 1)} -4 ${r2(t + 1)} -4 ${r2(t)} 2`,
    `C ${r2(t + 2)} 6 ${r2(m + 2)} ${r2(mid)} ${r2(e)} ${r2(len - 2)}`,
    `C ${r2(e - 1)} ${r2(len + 1)} ${r2(-e + 1)} ${r2(len + 1)} ${r2(-e)} ${r2(len - 2)}`,
    `C ${r2(-m - 2)} ${r2(mid)} ${r2(-t - 2)} 6 ${r2(-t)} 2`,
    `Z`,
  ].join(" ");
}

/* Turns a closed loop of landmark points into a smooth, organic silhouette
   using a Catmull-Rom spline converted to cubic beziers. */
function smoothClosed(pts: [number, number][]): string {
  const n = pts.length;
  const d: string[] = [];
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[i];
    const [nx, ny] = pts[(i + 1) % n];
    const [ppx, ppy] = pts[(i - 1 + n) % n];
    const [nnx, nny] = pts[(i + 2) % n];
    const c1x = px + (nx - ppx) / 6;
    const c1y = py + (ny - ppy) / 6;
    const c2x = nx - (nnx - px) / 6;
    const c2y = ny - (nny - py) / 6;
    if (i === 0) d.push(`M ${r2(px)} ${r2(py)}`);
    d.push(`C ${r2(c1x)} ${r2(c1y)} ${r2(c2x)} ${r2(c2y)} ${r2(nx)} ${r2(ny)}`);
  }
  d.push("Z");
  return d.join(" ");
}

/* Builds the body outline for a shape. A single continuous loop runs from
   the neck down the left shoulder, armpit, chest, ribs, waist and hips,
   around the left leg and foot, back up the inner thigh, through the
   crotch, down the right leg and foot, then back up the torso. The right
   leg is generated from the width profile; the left side is the exact
   mirror, so the pair stays coherent under any uniform scale. */
function bodyPath(s: BodyShape): string {
  const {
    neckY: N, shoulderY: SH, armpitY: AX, chestY: CH, ribY: RB, waistY: W,
    lowWaistY: LW, hipY: H, crotchY: CR, thighY: TH, kneeY: KN, calfY: CL,
    ankleY: AN, floorY: FL,
  } = FIGURE;
  const inner = (y: number) =>
    CENTER + s.legIn + (s.legOut - s.legIn) * ((y - CR) / (FL - CR));
  const R = {
    thighI: inner(TH), thighO: inner(TH) + s.thighW,
    kneeI: inner(KN), kneeO: inner(KN) + s.kneeW,
    calfI: inner(CL), calfO: inner(CL) + s.calfW,
    ankleI: inner(AN), ankleO: inner(AN) + s.ankleW,
  };
  const mirror = (x: number) => 2 * CENTER - x;
  const P = (x: number, y: number): [number, number] => [x, y];

  const pts: [number, number][] = [
    // left side, neck → foot
    P(CENTER - s.neckW, N),
    P(CENTER - s.shoulderW, SH),
    P(CENTER - s.armpitW, AX),
    P(CENTER - s.chestW, CH),
    P(CENTER - s.ribW, RB),
    P(CENTER - s.waistW, W),
    P(CENTER - s.lowWaistW, LW),
    P(CENTER - s.hipW, H),
    P(mirror(R.thighO), TH),
    P(mirror(R.kneeO), KN),
    P(mirror(R.calfO), CL),
    P(mirror(R.ankleO), AN),
    P(mirror(R.ankleO + s.footWing), FL - 6),
    P(mirror(R.ankleO + s.footWing - 3), FL),
    P(CENTER - s.footIn, FL),
    P(mirror(R.ankleI), AN),
    P(mirror(R.calfI), CL),
    P(mirror(R.kneeI), KN),
    P(mirror(R.thighI), TH),
    P(CENTER - s.legIn, CR),
    // right leg, crotch → foot
    P(CENTER + s.legIn, CR),
    P(R.thighI, TH),
    P(R.kneeI, KN),
    P(R.calfI, CL),
    P(R.ankleI, AN),
    P(CENTER + s.footIn, FL),
    P(R.ankleO + s.footWing - 3, FL),
    P(R.ankleO + s.footWing, FL - 6),
    P(R.ankleO, AN),
    P(R.calfO, CL),
    P(R.kneeO, KN),
    P(R.thighO, TH),
    // right torso back up to the neck
    P(CENTER + s.hipW, H),
    P(CENTER + s.lowWaistW, LW),
    P(CENTER + s.waistW, W),
    P(CENTER + s.ribW, RB),
    P(CENTER + s.chestW, CH),
    P(CENTER + s.armpitW, AX),
    P(CENTER + s.shoulderW, SH),
    P(CENTER + s.neckW, N),
  ];
  return smoothClosed(pts);
}

/* Subtle build variation so the lineup reads as different people, not
   cloned mannequins. Every build scales the base gender anatomy by a few
   percent - height, shoulder breadth, waist, hips, arm and leg thickness
   stay within believable human ranges. */
type Build = {
  sh: number;    // shoulder breadth
  chest: number; // upper torso volume
  waist: number; // waist width
  hip: number;   // hip width
  neck: number;  // neck width
  arm: number;   // arm + hand thickness
  leg: number;   // leg thickness and stance spread
  tall: number;  // overall height (uniform scale)
};

const BUILDS: Build[] = [
  { sh: 1.02, chest: 1.02, waist: 0.99, hip: 0.99, neck: 1.01, arm: 1.02, leg: 1.02, tall: 1.006 },
  { sh: 1.0, chest: 1.0, waist: 0.99, hip: 1.01, neck: 1.0, arm: 0.99, leg: 0.99, tall: 0.999 },
  { sh: 0.99, chest: 0.99, waist: 0.98, hip: 1.02, neck: 0.99, arm: 0.98, leg: 1.0, tall: 0.994 },
  { sh: 1.01, chest: 1.0, waist: 1.01, hip: 1.0, neck: 1.0, arm: 1.01, leg: 0.99, tall: 1.003 },
  { sh: 1.0, chest: 1.0, waist: 0.98, hip: 1.0, neck: 1.0, arm: 1.0, leg: 1.02, tall: 1.0 },
  { sh: 0.98, chest: 0.99, waist: 1.0, hip: 0.99, neck: 0.99, arm: 0.99, leg: 1.0, tall: 0.996 },
];

function buildShape(gender: Gender, build: Build): BodyShape {
  const s = SHAPES[gender];
  return {
    ...s,
    neckW: s.neckW * build.neck,
    shoulderW: s.shoulderW * build.sh,
    armpitW: s.armpitW * build.sh,
    chestW: s.chestW * build.chest,
    ribW: s.ribW * build.waist,
    waistW: s.waistW * build.waist,
    lowWaistW: s.lowWaistW * build.hip,
    hipW: s.hipW * build.hip,
    thighW: s.thighW * build.leg,
    kneeW: s.kneeW * build.leg,
    calfW: s.calfW * build.leg,
    ankleW: s.ankleW * build.leg,
    footWing: s.footWing * build.leg,
    upper: {
      top: s.upper.top * build.arm,
      mid: s.upper.mid * build.arm,
      end: s.upper.end * build.arm,
      len: s.upper.len,
    },
    fore: {
      top: s.fore.top * build.arm,
      end: s.fore.end * build.arm,
      len: s.fore.len,
    },
    hand: { rx: s.hand.rx * build.arm, ry: s.hand.ry * build.arm },
  };
}

/* Bodies are derived from gender × build, then cached so 30+ members stay
   cheap and never rebuild the same path twice. */
const shapeCache = new Map<string, BodyShape>();
const pathCache = new Map<string, string>();

function shapeFor(gender: Gender, index: number): BodyShape {
  const key = `${gender}:${index % BUILDS.length}`;
  let shape = shapeCache.get(key);
  if (!shape) {
    shape = buildShape(gender, BUILDS[index % BUILDS.length]);
    shapeCache.set(key, shape);
  }
  return shape;
}

function bodyPathFor(gender: Gender, index: number): string {
  const key = `${gender}:${index % BUILDS.length}`;
  let path = pathCache.get(key);
  if (!path) {
    path = bodyPath(shapeFor(gender, index));
    pathCache.set(key, path);
  }
  return path;
}

/* A subtle human head silhouette - fuller upper skull, gently narrower jaw
   and a soft chin - instead of a perfect oval. Scaled by rx/ry per shape. */
const HEAD_UNIT: [number, number][] = [
  [0, -1],
  [-0.52, -0.96],
  [-0.88, -0.74],
  [-1, -0.36],
  [-0.97, 0.04],
  [-0.82, 0.4],
  [-0.56, 0.7],
  [-0.27, 0.9],
  [0, 0.98],
  [0.27, 0.9],
  [0.56, 0.7],
  [0.82, 0.4],
  [0.97, 0.04],
  [1, -0.36],
  [0.88, -0.74],
  [0.52, -0.96],
];

function headPath(h: BodyShape["head"]): string {
  const pts = HEAD_UNIT.map(
    ([x, y]) => [h.cx + x * h.rx, h.cy + y * h.ry] as [number, number]
  );
  return smoothClosed(pts);
}

/* Female hair: a single smooth silhouette drawn behind the head - a soft
   cap over the skull plus a straight shoulder-length fall that frames the
   face. It hugs the skull on top, widens just past the ears and tapers to
   a rounded hem below the jaw - a clean silhouette detail, not a separate
   character element. */
const HAIR_UNIT: [number, number][] = [
  [0, -1.18],
  [0.5, -1.13],
  [0.9, -0.94],
  [1.1, -0.66],
  [1.22, -0.34],
  [1.28, 0],
  [1.3, 0.34],
  [1.28, 0.7],
  [1.2, 1.06],
  [1.06, 1.4],
  [0.6, 1.5],
  [0, 1.56],
  [-0.6, 1.5],
  [-1.06, 1.4],
  [-1.2, 1.06],
  [-1.28, 0.7],
  [-1.3, 0.34],
  [-1.28, 0],
  [-1.22, -0.34],
  [-1.1, -0.66],
  [-0.9, -0.94],
  [-0.5, -1.13],
];

function hairPath(h: BodyShape["head"]): string {
  const pts = HAIR_UNIT.map(
    ([x, y]) => [h.cx + x * h.rx, h.cy + y * h.ry] as [number, number]
  );
  return smoothClosed(pts);
}

/* The female hair shape depends only on the female head shape, which is a
   constant, so build the path once and reuse it for every female member. */
const FEMALE_HAIR = hairPath(SHAPES.female.head);

/* ONE canonical neutral standing pose for every member - a professional
   group portrait. Shoulders relaxed, arms hanging symmetrically beside the
   torso with a slight natural elbow bend, hands near the upper thighs,
   head centred. No per-member pose variation. */
type Pose = { left: [number, number]; right: [number, number]; tilt: number };

const POSE: Pose = { left: [-4, -8], right: [4, 8], tilt: 0 };

/* --------------------------------------------------------------------- */
/* Layout                                                                */
/* --------------------------------------------------------------------- */

/* A cinematic lineup: a focused figure in front with neighbours receding
   in depth. `slot` < figure width so people overlap slightly - they stand
   together rather than in boxes. */
function layout(width: number) {
  const ar = 220 / 400;
  if (width >= 1024) {
    const figH = Math.min(560, Math.max(460, width * 0.42));
    return { R: 3, figH, figW: figH * ar, slot: figH * ar * 0.9 };
  }
  if (width >= 768) {
    const figH = Math.min(500, Math.max(420, width * 0.5));
    return { R: 2, figH, figW: figH * ar, slot: figH * ar * 0.82 };
  }
  const figH = Math.min(470, Math.max(300, width * 1.05));
  return { R: 1, figH, figW: figH * ar, slot: figH * ar * 0.6 };
}

const pad = (n: number) => String(n).padStart(2, "0");

const ARROW_BTN =
  "grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full " +
  "border border-white/15 text-foreground/75 transition hover:border-accent/50 " +
  "hover:text-accent focus-visible:outline-offset-2";

/* --------------------------------------------------------------------- */
/* Component                                                             */
/* --------------------------------------------------------------------- */

export default function AboutMembers({
  members: membersInput,
  labelledBy,
  label = "Team members",
  prevLabel = "Previous member",
  nextLabel = "Next member",
}: {
  members: { name: string; role: string; major: string; gender: string }[];
  labelledBy?: string;
  label?: string;
  prevLabel?: string;
  nextLabel?: string;
}) {
  /* JSON dictionaries type `gender` as a plain string - normalize it to the
     gender union the figure geometry needs before anything reads it. */
  const members = useMemo(
    () =>
      membersInput.map((m) => ({
        ...m,
        gender: m.gender === "female" ? ("female" as Gender) : ("male" as Gender),
      })),
    [membersInput]
  );
  const reduce = useReducedMotion();
  const coarse = useCoarse();
  const count = members.length;

  const stageRef = useRef<HTMLDivElement>(null);
  const [stageW, setStageW] = useState(0);
  const [active, setActive] = useState(0);
  const [dir, setDir] = useState<"ltr" | "rtl">(() =>
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("dir") === "rtl"
      ? "rtl"
      : "ltr"
  );

  /* Pointer position of the desktop spotlight. Motion values only: moving
     the mouse never re-renders the carousel. */
  const pointerX = useMotionValue(0);
  const pointerHover = useMotionValue(0);
  const dragX = useMotionValue(0);

  const drag = useRef<{
    id: number | null;
    start: number;
    moving: boolean;
  }>({ id: null, start: 0, moving: false });
  const suppressClick = useRef(false);

  /* Hover-intent: the pointer must rest over a figure for a short window
     before it becomes the active member, so quick sweeps across the row
     don't flip through members. The spotlight still tracks the pointer
     instantly - only the selection waits. */
  const hoverIntent = 200;
  const pendingTarget = useRef<number | null>(null);
  const hoverTimer = useRef<number | null>(null);

  /* Keep the spotlight mirroring the document direction (EN/AR). */
  useEffect(() => {
    const root = document.documentElement;
    const update = () =>
      setDir(root.getAttribute("dir") === "rtl" ? "rtl" : "ltr");
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["dir"] });
    return () => observer.disconnect();
  }, []);

  /* Measure the stage and derive the visible window size. */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      setStageW(Math.round(entry?.contentRect.width ?? stage.clientWidth));
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const lo = useMemo(() => layout(stageW || 400), [stageW]);

  if (count === 0) return null;

  /* Never drift out of range when the dataset changes (e.g. language). */
  const current = Math.min(Math.max(0, active), count - 1);

  const R = Math.min(lo.R, Math.max(1, Math.floor(((stageW || 400) * 0.52) / lo.slot)));
  const { figW, figH, slot } = lo;
  const stageH = Math.round(figH * 1.04 + 24);
  const dirSign = dir === "rtl" ? -1 : 1;
  const beamEnabled = !reduce && !coarse && stageW >= 768;

  /* Horizontal centre of the figure for index i, in stage coordinates.
     This is the single layout used by rendering, pointer hit-testing and
     glow sync - so focus and glow can never disagree. */
  const centerX = (i: number) =>
    stageW / 2 + (i - current) * slot * dirSign;

  const from = Math.max(0, current - R);
  const to = Math.min(count - 1, current + R);
  const indices: number[] = [];
  for (let i = from; i <= to; i++) indices.push(i);

  /* Hover-intent helper: drop any pending selection. Called whenever the
     pointer leaves a figure, navigation happens explicitly, or a drag
     begins - a stale timer must never fire after the pointer moved away. */
  const cancelHover = () => {
    pendingTarget.current = null;
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  /* Single source of truth: every navigation path lands here, and the glow
     is re-synced to the newly focused figure. Pointer motion, on the other
     hand, jumps the glow instantly and, after a hover-intent window, sets
     `active`. An explicit selection always cancels a pending hover first. */
  const select = (index: number) => {
    cancelHover();
    const target = Math.min(Math.max(0, index), count - 1);
    setActive(target);
    /* The newly focused figure always settles at the stage centre, so the
       glow glides there while the figure steps forward. */
    if (beamEnabled && stageRef.current && stageW) {
      const cx = stageW / 2;
      if (reduce) pointerX.set(cx);
      else animate(pointerX, cx, { duration: 0.4, ease: EASE });
      pointerHover.set(1);
    }
  };

  const goTo = (index: number) => select(index);

  const wrap = (index: number) => ((index % count) + count) % count;

  const settleDrag = () => {
    if (reduce) dragX.set(0);
    else animate(dragX, 0, { type: "spring", ...SETTLE_SPRING });
  };

  /* Restart the hover-intent window for the given figure. Every pointer
     move that stays over the same target re-arms it, so the member only
     activates after the pointer has genuinely rested there. */
  const armHover = (index: number) => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      if (pendingTarget.current === index) {
        pendingTarget.current = null;
        select(index);
      }
    }, hoverIntent);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    cancelHover();
    if (e.pointerType === "mouse" || e.button !== 0) return;
    drag.current = { id: e.pointerId, start: e.clientX, moving: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d.id !== null && d.id === e.pointerId) {
      const dx = e.clientX - d.start;
      if (!d.moving && Math.abs(dx) > 8) d.moving = true;
      if (d.moving) dragX.set(dx);
      return;
    }
    if (reduce || coarse || e.pointerType !== "mouse") return;
    const stage = stageRef.current;
    if (!stage || !stageW) return;
    const rect = stage.getBoundingClientRect();
    const xRel = e.clientX - rect.left;

    /* Glow tracks the pointer in real time (no lag, no React state). */
    pointerX.set(xRel);
    pointerHover.set(1);

    /* Focus follows the nearest figure, using the exact same geometry as
       rendering. The active member only changes after the pointer has
       rested over a figure for the hover-intent window, so quick sweeps
       across the row don't flip through members; the glow still tracks the
       pointer instantly. */
    let best = -1;
    let bestDist = Infinity;
    for (
      let i = Math.max(0, current - R - 1);
      i <= Math.min(count - 1, current + R + 1);
      i++
    ) {
      const d = Math.abs(centerX(i) - xRel);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best >= 0 && bestDist < slot * 0.65) {
      if (best === current) {
        cancelHover();
      } else {
        if (best !== pendingTarget.current) pendingTarget.current = best;
        armHover(best);
      }
    } else {
      cancelHover();
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d.id !== e.pointerId) return;
    const dx = e.clientX - d.start;
    drag.current = { id: null, start: 0, moving: false };
    if (d.moving) {
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 350);
      /* Positive delta (in reading direction) moves forward. */
      const delta = dir === "rtl" ? dx : -dx;
      if (delta > slot * 0.35) goTo(current + 1);
      else if (delta < -slot * 0.35) goTo(current - 1);
    }
    settleDrag();
  };

  const onPointerEnd = () => {
    cancelHover();
    drag.current = { id: null, start: 0, moving: false };
    settleDrag();
    pointerHover.set(0);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    /* Direction-aware: in RTL the "next" member sits to the left, so the
       same logical arrows navigate it without hard-coding a direction. */
    const next = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const prev = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    if (e.key === next) {
      e.preventDefault();
      goTo(wrap(current + 1));
    } else if (e.key === prev) {
      e.preventDefault();
      goTo(wrap(current - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      goTo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      goTo(count - 1);
    }
  };

  const member = members[current];
  const itemTransition = reduce ? { duration: 0 } : DEPTH_SPRING;

  const figureButton = (index: number) => {
    const dist = Math.abs(index - current);
    const focus = Math.max(0, 1 - dist * 0.42);
    const x = (index - current) * slot * dirSign - figW / 2;
    return (
      <motion.div
        key={index}
        initial={false}
        className="absolute"
        style={{
          left: "50%",
          bottom: 10,
          width: figW,
          height: figH,
          zIndex: 40 - dist * 10,
          transformOrigin: "50% 100%",
          willChange: "transform, opacity, filter",
        }}
        animate={{
          x,
          scale: Math.max(0.55, 1 - dist * 0.14),
          opacity: Math.max(0.04, 1 - dist * 0.33),
          y: dist * 12,
          filter:
            dist === 0 || reduce
              ? "blur(0px)"
              : `blur(${(dist * 1.6).toFixed(1)}px)`,
        }}
        transition={itemTransition}
      >
        <button
          type="button"
          aria-label={`${index + 1} of ${count}, ${members[index].name} — ${members[index].role}`}
          aria-current={dist === 0 ? "true" : undefined}
          onClick={() => {
            if (suppressClick.current) return;
            select(index);
          }}
          onFocus={() => select(index)}
          className="block h-full w-full cursor-pointer focus-visible:outline-none"
          style={{ WebkitTapHighlightColor: "transparent" }}
        >
          <Figure
            index={index}
            member={members[index]}
            pose={POSE}
            focus={focus}
          />
        </button>
      </motion.div>
    );
  };

  const caption = (
    <div className="min-h-[8.5rem] sm:min-h-[7.5rem]">
      {reduce ? (
        <div>
          <p className="text-lg font-semibold leading-snug text-foreground sm:text-2xl">
            {member.name}
          </p>
          <p className="mt-1.5 text-sm font-medium leading-snug text-accent">
            {member.role}
          </p>
          <p className="mt-1 text-sm leading-snug text-muted">{member.major}</p>
        </div>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={member.name}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.28, ease: EASE }}
          >
            <p className="text-lg font-semibold leading-snug text-foreground sm:text-2xl">
              {member.name}
            </p>
            <p className="mt-1.5 text-sm font-medium leading-snug text-accent">
              {member.role}
            </p>
            <p className="mt-1 text-sm leading-snug text-muted">
              {member.major}
            </p>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );

  const stage = (
    <div className="relative">
      {/* Atmosphere pooling behind the group. A soft radial wash, not a
          box: it fades to transparent before any edge could read as a
          panel, so the stage blends into the page background. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 56% at 50% 44%, rgb(45 212 191 / 0.08), rgb(45 212 191 / 0.025) 48%, transparent 74%)",
        }}
      />
      {/* Receding grid floor that grounds the figures. It is not a closed
          rectangle: it sits outside the clipped stage and dissolves on
          every edge, so the grid melts into the page background instead of
          ending in hard rectangular lines. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0"
        style={{
          height: "48%",
          transform: "perspective(700px) rotateX(68deg)",
          transformOrigin: "top center",
          backgroundImage:
            "linear-gradient(to right, rgb(45 212 191 / 0.1) 1px, transparent 1px), linear-gradient(to bottom, rgb(45 212 191 / 0.1) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
          WebkitMaskImage:
            "radial-gradient(78% 62% at 50% 54%, black 34%, transparent 80%)",
          maskImage:
            "radial-gradient(78% 62% at 50% 54%, black 34%, transparent 80%)",
          opacity: 0.32,
        }}
      />
      <div
        ref={stageRef}
        role="group"
        aria-roledescription="carousel"
        aria-label={label}
        aria-labelledby={labelledBy}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerEnd}
        onPointerLeave={onPointerEnd}
        className="relative select-none overflow-hidden focus-visible:outline-none"
        style={{
          height: stageH,
          touchAction: "pan-y",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        {/* Wide, soft atmospheric glow that follows the pointer. It uses
            motion values directly - no state, no lag, no re-render. */}
        {beamEnabled && (
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-[4%] left-0 top-[8%] z-[5] w-[46%] min-w-[320px] max-w-[620px]"
            style={{
              x: pointerX,
              opacity: pointerHover,
              willChange: "transform, opacity",
            }}
          >
            <div
              className="h-full w-full -translate-x-1/2 rounded-full"
              style={{
                background:
                  "radial-gradient(closest-side, rgba(45,212,191,0.12), rgba(45,212,191,0.045) 46%, transparent 72%)",
                filter: "blur(40px)",
              }}
            />
          </motion.div>
        )}
        <motion.div className="absolute inset-0 z-10" style={{ x: dragX }}>
          {indices.map(figureButton)}
        </motion.div>
      </div>
    </div>
  );

  const progress = (
    <p className="font-mono text-xs tracking-[0.2em] text-muted" aria-live="polite">
      {pad(current + 1)} / {pad(count)}
    </p>
  );

  const controls = (
    <>
      {/* Flanking arrows (tablet + desktop). Logical start/end flip the
          button positions in Arabic; the icons are oriented to the button's
          physical side so the left button always points left and the right
          button always points right, in both languages. */}
      <button
        type="button"
        aria-label={prevLabel}
        onClick={() => goTo(wrap(current - 1))}
        className={`${ARROW_BTN} absolute start-2 top-1/2 z-20 hidden -translate-y-1/2 md:grid`}
      >
        <ArrowRightIcon className="h-4 w-4 rotate-180 rtl:rotate-0" />
      </button>
      <button
        type="button"
        aria-label={nextLabel}
        onClick={() => goTo(wrap(current + 1))}
        className={`${ARROW_BTN} absolute end-2 top-1/2 z-20 hidden -translate-y-1/2 md:grid`}
      >
        <ArrowRightIcon className="h-4 w-4 rtl:rotate-180" />
      </button>
      <div className="mt-6 flex items-center justify-center gap-5">
        <button
          type="button"
          aria-label={prevLabel}
          onClick={() => goTo(wrap(current - 1))}
          className={`${ARROW_BTN} md:hidden`}
        >
          <ArrowRightIcon className="h-4 w-4 rotate-180 rtl:rotate-0" />
        </button>
        {progress}
        <button
          type="button"
          aria-label={nextLabel}
          onClick={() => goTo(wrap(current + 1))}
          className={`${ARROW_BTN} md:hidden`}
        >
          <ArrowRightIcon className="h-4 w-4 rtl:rotate-180" />
        </button>
      </div>
    </>
  );

  return (
    <section className="mt-10" aria-labelledby={labelledBy}>
      {reduce ? (
        <div>
          <div className="relative">{stage}</div>
          {controls}
          <div className="mt-4 text-center">{caption}</div>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.7, ease: EASE }}
        >
          <div className="relative">
            {stage}
            {controls}
          </div>
          <div className="mt-4 text-center">{caption}</div>
        </motion.div>
      )}
    </section>
  );
}

/* --------------------------------------------------------------------- */
/* Figure                                                                */
/* --------------------------------------------------------------------- */

function Figure({
  index,
  member,
  pose,
  focus,
}: {
  index: number;
  member: Member;
  pose: Pose;
  focus: number;
}) {
  const uid = useId().replace(/[:]/g, "");
  const gradientId = `member-${uid}`;
  const fill = `url(#${gradientId})`;

  const shape = shapeFor(member.gender, index);
  const build = BUILDS[index % BUILDS.length];

  /* Subtle dark-rimmed silhouette - a hairline of light, not a neon
     outline. The focused figure simply comes forward more clearly. */
  const rim = `rgba(45, 212, 191, ${(0.16 + 0.26 * focus).toFixed(3)})`;
  const rimW = 1 + 0.5 * focus;
  const shadow =
    focus > 0.04
      ? `drop-shadow(0 0 ${(2 + 4 * focus).toFixed(1)}px rgba(45, 212, 191, ${(
          0.07 +
          0.12 * focus
        ).toFixed(2)}))`
      : "none";

  /* Height varies only with the body build (uniform scale) - the neutral
     standing pose itself never changes between members. */
  const scale = build.tall;

  /* A full tapered capsule per arm segment (upper + forearm + hand), hung
     from the shoulder joint and rotated by the pose angles. Drawn behind
     the torso so the deltoid seam stays covered. */
  const arm = (side: "left" | "right", angles: [number, number]) => {
    const s = shape;
    const out = s.shoulderW * 0.9;
    const pivotX = side === "left" ? CENTER - out : CENTER + out;
    const [shoulder, elbow] = angles;
    return (
      <g
        key={side}
        transform={`translate(${r2(pivotX)} ${s.armPivotY}) rotate(${shoulder})`}
      >
        <path
          d={limbPath(s.upper.len, s.upper.top, s.upper.mid, s.upper.end)}
          fill={fill}
          stroke={rim}
          strokeWidth={rimW}
          strokeLinejoin="round"
        />
        <g transform={`translate(0 ${r2(s.upper.len)}) rotate(${elbow})`}>
          <path
            d={limbPath(s.fore.len, s.fore.top, s.fore.top * 0.92, s.fore.end)}
            fill={fill}
            stroke={rim}
            strokeWidth={rimW}
            strokeLinejoin="round"
          />
          <ellipse
            cx="0"
            cy={r2(s.fore.len + s.hand.ry * 0.75)}
            rx={s.hand.rx}
            ry={s.hand.ry}
            fill={fill}
            stroke={rim}
            strokeWidth={rimW}
          />
        </g>
      </g>
    );
  };

  return (
    <div className="relative h-full w-full">
      {/* Ground contact shadow. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-1/2 h-1.5 -translate-x-1/2 rounded-[50%] bg-black/70 blur-[6px]"
        style={{
          width: `${26 + 22 * focus}%`,
          opacity: 0.35 + 0.65 * focus,
        }}
      />
      {/* Atmospheric pool behind this person. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[30%] h-[52%] w-[90%] -translate-x-1/2 rounded-full bg-accent/12 blur-[44px]"
        style={{ opacity: 0.1 * focus }}
      />
      <svg
        viewBox="0 0 220 400"
        className="absolute bottom-0 left-1/2 h-auto"
        aria-hidden="true"
        style={{
          width: "100%",
          transformOrigin: "50% 100%",
          /* Uniform scale only - the neutral pose is never distorted. */
          transform: `translateX(-50%) scale(${scale})`,
          filter: shadow,
        }}
      >
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2="0"
            y2="400"
          >
            <stop offset="0%" stopColor="#33436d" />
            <stop offset="45%" stopColor="#243352" />
            <stop offset="100%" stopColor="#162238" />
          </linearGradient>
        </defs>

        {/* Arms behind the torso; the torso covers every seam. */}
        {arm("left", pose.left)}
        {arm("right", pose.right)}

        {/* Head with a subtle natural tilt (neck base stays covered by the
            torso so the head never detaches). */}
        <g transform={`rotate(${pose.tilt} ${shape.head.cx} ${shape.head.cy})`}>
          {/* Hair sits behind the head so the head keeps its clean silhouette
              and rim; the fringe, side fall and soft hem peek out around it.
              Male members skip this entirely. */}
          {member.gender === "female" && (
            <path
              d={FEMALE_HAIR}
              fill={fill}
              stroke={rim}
              strokeWidth={rimW}
              strokeLinejoin="round"
            />
          )}
          <path
            d={headPath(shape.head)}
            fill={fill}
            stroke={rim}
            strokeWidth={rimW}
            strokeLinejoin="round"
          />
        </g>

        {/* Torso (drawn last: head, feet and arms all tuck behind it). */}
        <path
          d={bodyPathFor(member.gender, index)}
          fill={fill}
          stroke={rim}
          strokeWidth={rimW}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
