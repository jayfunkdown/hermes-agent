/**
 * Types for the vendored blobatar 2.0.0 `blob` entry
 * (self-contained SVG renderer; desktop uses the same package).
 */
export interface BlobatarOptions {
  size?: number;
  background?: boolean | "square" | "circle" | "squircle";
  hue?: number;
  tone?: number;
  traits?: Record<string, number | readonly number[]>;
  normalize?: boolean;
  contrast?: boolean;
  title?: string;
}

export type Shape =
  | "round"
  | "boxy"
  | "organic"
  | "cloud"
  | "sun"
  | "nub"
  | "capsule"
  | "triangle"
  | "hexagon"
  | "droplet";

export declare function blobatar(name: string, opts?: BlobatarOptions): string;

export declare function layout(t: {
  (key: string): number;
  num: (key: string, min: number, max: number) => number;
  int: (key: string, min: number, max: number) => number;
  pick: <T>(key: string, values: readonly T[]) => T;
  bool: (key: string, p?: number) => boolean;
  jitter: (key: string, amount: number) => number;
}): { shape: Shape };
