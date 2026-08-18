import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  OffthreadVideo,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/* The Scientific Committee logo animation (our original asset). The video is
   played as a whole — we only animate its container, never the artwork. */
const LOGO_SRC = staticFile("intro.backup.mp4");

/* Site identity palette (app/globals.css design tokens). */
const INK = "#0a0d12";
const TEAL_RGB = "45,212,191";
const CYAN_RGB = "34,211,238";
const ICE_RGB = "199,243,247";
const FOG_RGB = "140,190,200";

/* 480 frames @ 60 FPS = 8s. The whole envelope is authored in frames, so the
   values below are the 30 FPS originals scaled x2 for a true 60 FPS output;
   the breathing cycle is time-based (seconds) and needs no rescale. */
export const DURATION_IN_FRAMES = 480;
export const FPS = 60;

/* The reference animation language (the higher-quality logo upload):
   soft fog atmosphere -> emblem reveal (~1s) -> bright hold ->
   gentle dim (4.5-6s) -> bright pulse (~6.5s) -> calm settle.
   intro.backup.mp4 pulses internally at ~6.5s too, so the envelope below
   reinforces that rhythm without changing the logo itself. */

export const ScientificCommitteeHero: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  /* ---- Entrance (fog first, then the logo resolves into focus) ---- */
  const entranceOpacity = interpolate(frame, [0, 84], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const entrance = spring({
    frame,
    fps,
    durationInFrames: 92,
    config: { damping: 18, stiffness: 120, mass: 0.7 },
  });

  /* ---- Slow breathing for the whole scene ---- */
  const breathe = 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 5.5);

  /* ---- Bright pulse at ~6.5s ---- */
  const pulseIn = interpolate(frame, [368, 392], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pulseOut = interpolate(frame, [392, 440], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pulse = Math.min(pulseIn, pulseOut);

  /* ---- Gentle dim veil between 4s and the pulse ---- */
  const veil = interpolate(
    frame,
    [240, 320, 364, 392],
    [0, 0.22, 0.22, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  /* ---- Quick screen flash that peaks with the pulse ---- */
  const flash = interpolate(frame, [380, 392, 410], [0, 0.35, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  /* ---- Logo motion (whole-video transforms only) ---- */
  const logoScale = 0.96 + 0.04 * entrance + 0.012 * breathe + 0.045 * pulse;
  const logoY = (1 - entrance) * 26;
  const logoBlur = (1 - entrance) * 5;

  const glowOpacity = Math.min(
    1,
    0.44 + 0.2 * breathe + 0.65 * pulse + (1 - entranceOpacity) * 0.12
  );
  const glowScale = 1 + 0.06 * breathe + 0.55 * pulse;

  /* The reference opens on a soft atmospheric fog that recedes as the emblem
     comes into focus, then returns with the pulse. */
  const fogOpacity = Math.min(
    1,
    interpolate(frame, [0, 96], [1, 0.55], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) +
      0.08 * breathe +
      0.5 * pulse
  );

  /* ---- Light sweep across the logo on entrance ---- */
  const sweepLeft = interpolate(frame, [60, 148], [-40, 140], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const sweepOpacity = interpolate(frame, [60, 104, 148], [0, 0.08, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: INK, overflow: "hidden" }}>
      {/* Distant atmospheric fog */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 66% 52% at 50% 46%, rgba(${FOG_RGB},0.18), transparent 72%)`,
          opacity: fogOpacity,
        }}
      />

      {/* Ambient teal/cyan glow breathing behind the logo */}
      <AbsoluteFill style={{ display: "grid", placeItems: "center" }}>
        <div
          style={{
            width: 1200,
            height: 1200,
            borderRadius: "50%",
            background: `radial-gradient(circle, rgba(${TEAL_RGB},0.2), rgba(${CYAN_RGB},0.08) 42%, transparent 70%)`,
            opacity: glowOpacity,
            transform: `scale(${glowScale})`,
            filter: "blur(40px)",
          }}
        />
      </AbsoluteFill>

      {/* Our logo animation, animated as a whole */}
      <AbsoluteFill style={{ display: "grid", placeItems: "center" }}>
        <div
          style={{
            width: 1440,
            opacity: entranceOpacity,
            transform: `translateY(${logoY}px) scale(${logoScale})`,
            filter: `blur(${logoBlur}px)`,
            maskImage:
              "radial-gradient(ellipse 74% 74% at 50% 50%, black 52%, transparent 76%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 74% 74% at 50% 50%, black 52%, transparent 76%)",
          }}
        >
          <OffthreadVideo
            src={LOGO_SRC}
            muted
            style={{ width: "100%", display: "block" }}
          />
        </div>
      </AbsoluteFill>

      {/* Dim veil before the pulse */}
      <AbsoluteFill
        style={{ background: "#05070b", opacity: veil }}
      />

      {/* Slow light sweep */}
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            width: "42%",
            left: `${sweepLeft}%`,
            opacity: sweepOpacity,
            background: `linear-gradient(90deg, transparent, rgba(${CYAN_RGB},0.10) 45%, rgba(${TEAL_RGB},0.18) 50%, rgba(${CYAN_RGB},0.10) 55%, transparent)`,
            mixBlendMode: "screen",
          }}
        />
      </AbsoluteFill>

      {/* Bright pulse flash */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 55% 45% at 50% 46%, rgba(${ICE_RGB},0.9), rgba(${TEAL_RGB},0.25) 45%, transparent 72%)`,
          opacity: flash,
          mixBlendMode: "screen",
        }}
      />

      {/* Vignette for depth */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 90% 84% at 50% 50%, transparent 55%, rgba(2,4,8,0.55) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
