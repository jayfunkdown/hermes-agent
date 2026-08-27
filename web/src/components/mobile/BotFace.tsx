import { useEffect } from "react";
import { blobatar as blobatarSvg } from "blobatar/blob";

import {
  blobMarkup,
  facePose,
  isBlobShape,
  isDarkColor,
  paintMathFace,
  ringToPath,
  sampleFaceRing,
  sigilGeometry,
} from "@/lib/bot-face-math";
import { startFaceClock, stopFaceClock } from "@/lib/bot-face-clock";
import { defaultShapeFor } from "@/lib/mobile-bot-roster";
import { cn } from "@/lib/utils";

interface BotFaceProps {
  shape: string;
  color: string;
  image?: string | null;
  name?: string;
  mood?: "work" | "idle";
  size?: number;
  className?: string;
}

function SigilFace({
  shape,
  color,
  name,
  size,
  className,
}: {
  shape: string;
  color: string;
  name: string;
  size: number;
  className?: string;
}) {
  const seed = Number(shape.slice(6)) || 0;
  const { strokes, ring } = sigilGeometry(name, seed);
  return (
    <svg
      data-bot-face={name}
      viewBox="0 0 40 40"
      width={size}
      height={size}
      aria-hidden
      className={cn("block", className)}
    >
      {ring ? <path d={ring} fill="none" stroke={color} strokeWidth={1.2} opacity={0.5} /> : null}
      <path
        d={strokes}
        fill="none"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={16} cy={14} r={2.4} fill={color} />
      <circle cx={24} cy={14} r={2.4} fill={color} />
    </svg>
  );
}

function MathFace({
  shape,
  color,
  name,
  mood,
  size,
  className,
}: {
  shape: string;
  color: string;
  name: string;
  mood: "work" | "idle";
  size: number;
  className?: string;
}) {
  useEffect(() => {
    startFaceClock();
    return () => stopFaceClock();
  }, []);

  const working = mood === "work";
  const eyeFill = isDarkColor(color) ? "rgba(232,220,195,0.95)" : "rgba(0,0,0,0.85)";
  const hlFill = isDarkColor(color) ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.85)";
  const rest = facePose(working ? "work" : "idle", 0);
  const eyeY0 = shape === "cloud" ? 22 : 17.2;
  const bodyPath =
    shape === "cloud"
      ? "M11 32 a7.5 7.5 0 0 1 -1 -14.9 A9.5 9.5 0 0 1 29 12.5 A7 7 0 0 1 30 32 Z"
      : ringToPath(sampleFaceRing(shape));

  return (
    <svg
      data-bot-face={name}
      data-hb-math="1"
      data-hb-mood={working ? "work" : "idle"}
      data-hb-shape={shape || "circle"}
      viewBox="0 0 40 44"
      width={size}
      height={size}
      aria-hidden
      className={cn("block overflow-visible", className)}
      ref={(node) => {
        if (node) paintMathFace(node, 0);
      }}
    >
      <path data-hb-body d={bodyPath} fill={color} />
      <g data-hb-open>
        <ellipse
          data-hb-el
          cx={15.4}
          cy={eyeY0}
          rx={2.2}
          ry={working ? 2.6 : 2.3}
          fill={eyeFill}
        />
        <ellipse
          data-hb-er
          cx={24.6}
          cy={eyeY0}
          rx={2.2}
          ry={working ? 2.6 : 2.3}
          fill={eyeFill}
        />
        <circle data-hb-hl-l cx={14.8} cy={eyeY0 - 0.7} r={0.65} fill={hlFill} />
        <circle data-hb-hl-r cx={24} cy={eyeY0 - 0.7} r={0.65} fill={hlFill} />
      </g>
      <path
        data-hb-shut
        d={`M12.8 ${eyeY0} L18 ${eyeY0} M22 ${eyeY0} L27.2 ${eyeY0}`}
        stroke={eyeFill}
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
        opacity={0}
      />
      {working ? (
        <g>
          <circle data-hb-dot cx={16.4} cy={41.2} r={1.15} fill={color} opacity={rest.d0} />
          <circle data-hb-dot cx={20} cy={41.2} r={1.15} fill={color} opacity={rest.d1} />
          <circle data-hb-dot cx={23.6} cy={41.2} r={1.15} fill={color} opacity={rest.d2} />
        </g>
      ) : null}
    </svg>
  );
}

export function BotFace({
  shape,
  color,
  image,
  name = "agent",
  mood = "idle",
  size = 36,
  className,
}: BotFaceProps) {
  if (image) {
    return (
      <img
        src={image}
        alt=""
        aria-hidden
        className={cn("block rounded-[22%] object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  const resolvedShape = shape || defaultShapeFor(name);

  if (isBlobShape(resolvedShape)) {
    const markup = blobMarkup(resolvedShape, name, size, blobatarSvg);
    if (markup) {
      return (
        <span
          aria-hidden
          className={cn("block leading-none", className)}
          style={{ width: size, height: size }}
          dangerouslySetInnerHTML={{ __html: markup }}
        />
      );
    }
  }

  if (resolvedShape.startsWith("sigil-")) {
    return <SigilFace shape={resolvedShape} color={color} name={name} size={size} className={className} />;
  }

  return (
    <MathFace
      shape={resolvedShape}
      color={color}
      name={name}
      mood={mood}
      size={size}
      className={className}
    />
  );
}
