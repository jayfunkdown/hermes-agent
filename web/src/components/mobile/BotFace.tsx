import { useMemo } from "react";
import { blobatar as blobatarSvg } from "blobatar/blob";

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

function isBlobShape(shape: string): boolean {
  return shape === "blobatar" || shape.startsWith("blobatar:");
}

function parseBlobShape(shape: string, name: string) {
  const parts = shape.split(":");
  const seedPart = parts[1] || "";
  const kind = parts[2] || "";
  return { seed: seedPart || name || "agent", kind };
}

function blobMarkup(shape: string, name: string, size: number): string | null {
  try {
    const { seed, kind } = parseBlobShape(shape, name);
    const opts: { size: number; traits?: { shape: number } } = { size };
    if (kind) {
      opts.traits = { shape: 0.5 };
    }
    return blobatarSvg(seed, opts);
  } catch {
    return null;
  }
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
  const markup = useMemo(() => {
    if (image) return null;
    const resolvedShape = isBlobShape(shape) ? shape : shape || defaultShapeFor(name);
    if (isBlobShape(resolvedShape)) {
      return blobMarkup(resolvedShape, name, size);
    }
    return null;
  }, [image, name, shape, size]);

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

  if (markup) {
    return (
      <span
        aria-hidden
        className={cn("block leading-none", mood === "work" && "animate-pulse", className)}
        style={{ width: size, height: size }}
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex items-center justify-center rounded-[28%] text-[0.7rem] font-semibold text-white shadow-sm",
        mood === "work" && "animate-pulse",
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
      }}
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}
