/** Desktop-parity math-face geometry for Bot Mode avatars (ported from hermes-bots). */

export const BLOB_KINDS = [
  "round",
  "organic",
  "boxy",
  "capsule",
  "nub",
  "cloud",
  "droplet",
  "hexagon",
  "sun",
  "triangle",
] as const;

export const BLOB_KIND_TRAIT: Record<string, number> = {
  round: 0.11,
  organic: 0.35,
  boxy: 0.54,
  capsule: 0.65,
  nub: 0.745,
  cloud: 0.825,
  droplet: 0.8875,
  hexagon: 0.9325,
  sun: 0.965,
  triangle: 0.99,
};

export function isBlobShape(shape: string): boolean {
  return shape === "blobatar" || shape.startsWith("blobatar:");
}

export function parseBlobShape(shape: string, name: string) {
  const parts = shape.split(":");
  const seedPart = parts[1] || "";
  const kind = BLOB_KINDS.includes(parts[2] as (typeof BLOB_KINDS)[number]) ? parts[2] : "";
  return { seed: seedPart || name || "agent", seedPart, kind };
}

export function isDarkColor(hex: string): boolean {
  try {
    const n = Number.parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
  } catch {
    return false;
  }
}

/** The roster backfill draws the live SVG at 160x160 — not a real user photo. */
export function isBackfilledFacePng(dataUrl: string | null | undefined): boolean {
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
    return false;
  }
  try {
    const bin = atob(dataUrl.slice("data:image/png;base64,".length).slice(0, 48));
    if (bin.length < 24) return false;
    const w =
      (bin.charCodeAt(16) << 24) |
      (bin.charCodeAt(17) << 16) |
      (bin.charCodeAt(18) << 8) |
      bin.charCodeAt(19);
    const h =
      (bin.charCodeAt(20) << 24) |
      (bin.charCodeAt(21) << 16) |
      (bin.charCodeAt(22) << 8) |
      bin.charCodeAt(23);
    return w === 160 && h === 160;
  } catch {
    return false;
  }
}

function sigilRng(text: string) {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0 || 88675123;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

export function sigilGeometry(name: string, seed: number) {
  const rng = sigilRng(`${name}::${seed}`);
  const gx = (i: number) => 6 + i * 7;
  const gy = (j: number) => 8 + j * 6;
  const strokes: string[] = [];
  const segments = 4 + Math.floor(rng() * 3);

  for (let k = 0; k < segments; k++) {
    const x1 = Math.floor(rng() * 3);
    const y1 = Math.floor(rng() * 5);
    const x2 = Math.min(2, Math.max(0, x1 + (rng() > 0.5 ? 1 : -1)));
    const y2 = Math.min(4, Math.max(0, y1 + Math.floor(rng() * 3) - 1));
    strokes.push(`M${gx(x1)} ${gy(y1)} L${gx(x2)} ${gy(y2)}`);
    strokes.push(`M${gx(4 - x1)} ${gy(y1)} L${gx(4 - x2)} ${gy(y2)}`);
    if (rng() > 0.6) {
      strokes.push(`M${gx(x2)} ${gy(y2)} L${gx(4 - x2)} ${gy(y2)}`);
    }
  }

  strokes.push(`M20 ${gy(0)} L20 ${gy(4)}`);
  const ring = rng() > 0.45 ? "M20 4 L36 20 L20 36 L4 20 Z" : null;
  return { strokes: strokes.join(" "), ring };
}

function cubicAt(p0: number[], p1: number[], p2: number[], p3: number[], t: number) {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

function sampleDropRing(steps: number) {
  const pts: number[][] = [];
  const n = Math.max(8, Math.floor(steps / 3));
  for (let i = 0; i < n; i++) {
    pts.push(cubicAt([20, 3], [20, 3], [6, 20], [6, 27], i / n));
  }
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI;
    pts.push([20 - 14 * Math.cos(t), 27 + 13.5 * Math.sin(t)]);
  }
  for (let i = 1; i <= n; i++) {
    pts.push(cubicAt([34, 27], [34, 20], [20, 3], [20, 3], i / n));
  }
  return pts;
}

function svgArc(x1: number, y1: number, rx: number, ry: number, fa: number, fs: number, x2: number, y2: number) {
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  let rx2 = rx * rx;
  let ry2 = ry * ry;
  const lam = (dx * dx) / rx2 + (dy * dy) / ry2;
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx *= s;
    ry *= s;
    rx2 = rx * rx;
    ry2 = ry * ry;
  }
  const num = rx2 * ry2 - rx2 * dy * dy - ry2 * dx * dx;
  const den = rx2 * dy * dy + ry2 * dx * dx;
  let sq = Math.sqrt(Math.max(0, num / den));
  if (fa === fs) sq = -sq;
  const cx = (sq * (rx * dy)) / ry + (x1 + x2) / 2;
  const cy = (sq * (-ry * dx)) / rx + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const denom = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1;
    let a = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / denom)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = ang(1, 0, (x1 - cx) / rx, (y1 - cy) / ry);
  let dtheta = ang((x1 - cx) / rx, (y1 - cy) / ry, (x2 - cx) / rx, (y2 - cy) / ry);
  if (!fs && dtheta > 0) dtheta -= Math.PI * 2;
  if (fs && dtheta < 0) dtheta += Math.PI * 2;
  return { cx, cy, rx, ry, theta1, dtheta };
}

function sampleArc(arc: ReturnType<typeof svgArc>, n: number) {
  const pts: number[][] = [];
  for (let i = 0; i < n; i++) {
    const th = arc.theta1 + arc.dtheta * (i / n);
    pts.push([arc.cx + arc.rx * Math.cos(th), arc.cy + arc.ry * Math.sin(th)]);
  }
  return pts;
}

function sampleCloudRing(steps: number) {
  const a1 = svgArc(11, 32, 7.5, 7.5, 0, 1, 10, 17.1);
  const a2 = svgArc(10, 17.1, 9.5, 9.5, 0, 1, 29, 12.5);
  const a3 = svgArc(29, 12.5, 7, 7, 0, 1, 30, 32);
  const len1 = Math.abs(a1.dtheta) * a1.rx;
  const len2 = Math.abs(a2.dtheta) * a2.rx;
  const len3 = Math.abs(a3.dtheta) * a3.rx;
  const len4 = 19;
  const total = len1 + len2 + len3 + len4;
  const n = Math.max(64, steps);
  const n1 = Math.max(8, Math.round((n * len1) / total));
  const n2 = Math.max(10, Math.round((n * len2) / total));
  const n3 = Math.max(10, Math.round((n * len3) / total));
  const n4 = Math.max(4, n - n1 - n2 - n3);
  const pts: number[][] = [];
  pts.push(...sampleArc(a1, n1));
  pts.push(...sampleArc(a2, n2));
  pts.push(...sampleArc(a3, n3));
  for (let i = 0; i < n4; i++) {
    pts.push([30 + ((11 - 30) * i) / n4, 32]);
  }
  return pts;
}

export function sampleFaceRing(shape: string, steps = 52): number[][] {
  const kind = shape.startsWith("sigil-") ? "circle" : shape;
  if (kind === "drop" || kind === "teardrop") return sampleDropRing(steps);
  if (kind === "cloud") return sampleCloudRing(steps);

  const pts: number[][] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2 - Math.PI / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    let rx = 16;
    let ry = 16;
    if (kind === "circle") {
      rx = ry = 16.2;
    } else if (kind === "blob") {
      rx = ry = 16 + 1.7 * Math.sin(3 * a) + 0.7 * Math.cos(5 * a);
    } else if (kind === "squircle") {
      const p = 5;
      const d = (Math.abs(c) ** p + Math.abs(s) ** p) ** (1 / p) || 1;
      rx = ry = 16.2 / d;
    } else if (kind === "pill") {
      const d = (Math.abs(c) ** 8 + Math.abs(s / 0.72) ** 8) ** (1 / 8) || 1;
      rx = ry = 16 / d;
    } else if (kind === "triangle" || kind === "tetrahedron" || kind === "wedge") {
      const u = (a + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
      const sector = (u / ((Math.PI * 2) / 3)) % 1;
      rx = ry = 13.5 / Math.max(0.42, Math.cos((sector - 0.5) * 1.9));
    } else if (kind === "hexagon" || kind === "hex" || kind === "icosahedron" || kind === "dodecahedron") {
      const seg = Math.PI / 3;
      const hex = Math.cos(seg / 2) / Math.cos(a - seg * Math.round(a / seg));
      rx = ry = 16.2 * hex;
    } else if (kind === "cube" || kind === "octahedron") {
      const p = 3.1;
      const d = (Math.abs(c) ** p + Math.abs(s) ** p) ** (1 / p) || 1;
      rx = ry = 16 / d;
    } else if (kind === "pebble") {
      rx = 16.4 * (1.04 - 0.14 * Math.cos(2 * a));
      ry = 15.2 * (1.06 + 0.08 * Math.sin(2 * a));
    } else {
      rx = ry = 16.2;
    }
    pts.push([20 + rx * c, 20 + ry * s]);
  }
  return pts;
}

function projectFacePoint(x: number, y: number, turn: number, tilt: number, roll: number) {
  const dx = x - 20;
  const dy = y - 20;
  const r = (roll * Math.PI) / 180;
  const xr = dx * Math.cos(r) - dy * Math.sin(r);
  const yr = dx * Math.sin(r) + dy * Math.cos(r);
  const sx = 0.74 + 0.26 * Math.abs(Math.cos((turn * Math.PI) / 180));
  const sy = 0.8 + 0.2 * Math.abs(Math.cos((tilt * Math.PI) / 180));
  return [20 + xr * sx, 20 + yr * sy];
}

export function ringToPath(pts: number[][]) {
  if (!pts.length) return "";
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    d += `L${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)}`;
  }
  return `${d}Z`;
}

export function facePose(mood: "work" | "idle", t: number) {
  if (mood === "work") {
    return {
      turn: -11 + Math.sin(t * 0.48) * 8,
      tilt: Math.sin(t * 0.42) * 8 + Math.sin(t * 1.1) * 1.6,
      roll: Math.sin(t * 0.75) * 4.2,
      gazeX: Math.sin(t * 0.55) * 3.6,
      gazeY: -1.6 + Math.sin(t * 0.38) * 2,
      blink: t % 1.45 > 1.26,
      d0: 0.2 + 0.8 * Math.max(0, Math.sin(t * 2.6)),
      d1: 0.2 + 0.8 * Math.max(0, Math.sin(t * 2.6 - 0.7)),
      d2: 0.2 + 0.8 * Math.max(0, Math.sin(t * 2.6 - 1.4)),
    };
  }
  return {
    turn: Math.sin(t * 0.5) * 1.5,
    tilt: Math.sin(t * 0.27),
    roll: Math.sin(t * 0.85) * 1.2,
    gazeX: 0,
    gazeY: 0,
    blink: t % 3.2 > 3.02,
    d0: 0,
    d1: 0,
    d2: 0,
  };
}

export function paintMathFace(svg: SVGSVGElement, t: number) {
  const mood = (svg.getAttribute("data-hb-mood") || "idle") as "work" | "idle";
  const shape = svg.getAttribute("data-hb-shape") || "circle";
  const pose = facePose(mood, t);
  const body = svg.querySelector("[data-hb-body]");
  const open = svg.querySelector("[data-hb-open]");
  const shut = svg.querySelector("[data-hb-shut]");
  const el = svg.querySelector("[data-hb-el]");
  const er = svg.querySelector("[data-hb-er]");
  const dots = svg.querySelectorAll("[data-hb-dot]");

  if (body) {
    if (shape === "cloud") {
      body.setAttribute("d", "M11 32 a7.5 7.5 0 0 1 -1 -14.9 A9.5 9.5 0 0 1 29 12.5 A7 7 0 0 1 30 32 Z");
    } else {
      const ring = sampleFaceRing(shape).map(([x, y]) => projectFacePoint(x, y, pose.turn, pose.tilt, pose.roll));
      body.setAttribute("d", ringToPath(ring));
    }
  }

  const eyeY = (shape === "cloud" ? 22 : 17.2) + pose.gazeY;
  const eyeL = 15.4 + pose.gazeX;
  const eyeR = 24.6 + pose.gazeX;

  if (el) {
    el.setAttribute("cx", String(eyeL));
    el.setAttribute("cy", String(eyeY));
  }
  if (er) {
    er.setAttribute("cx", String(eyeR));
    er.setAttribute("cy", String(eyeY));
  }

  const hl = svg.querySelector("[data-hb-hl-l]");
  const hr = svg.querySelector("[data-hb-hl-r]");
  if (hl) {
    hl.setAttribute("cx", String(eyeL - 0.6));
    hl.setAttribute("cy", String(eyeY - 0.7));
  }
  if (hr) {
    hr.setAttribute("cx", String(eyeR - 0.6));
    hr.setAttribute("cy", String(eyeY - 0.7));
  }

  if (open) open.setAttribute("opacity", pose.blink ? "0" : "1");
  if (shut) {
    shut.setAttribute("d", `M${eyeL - 2.6} ${eyeY} L${eyeL + 2.6} ${eyeY} M${eyeR - 2.6} ${eyeY} L${eyeR + 2.6} ${eyeY}`);
    shut.setAttribute("opacity", pose.blink ? "1" : "0");
  }

  dots.forEach((dot, i) => {
    const o = i === 0 ? pose.d0 : i === 1 ? pose.d1 : pose.d2;
    dot.setAttribute("opacity", String(o));
  });

  svg.style.transform = `rotate(${pose.tilt}deg)`;
  svg.style.transformOrigin = "50% 70%";
}

export function walkMathFaces(root: ParentNode | null, acc: SVGSVGElement[] = []): SVGSVGElement[] {
  if (!root || !("querySelectorAll" in root)) return acc;
  root.querySelectorAll("svg[data-hb-math]").forEach((node) => acc.push(node as SVGSVGElement));
  root.querySelectorAll("*").forEach((el) => {
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) walkMathFaces(shadow, acc);
  });
  return acc;
}

export function blobMarkup(
  shape: string,
  name: string,
  size: number,
  blobatarSvg: (seed: string, opts: { size: number; traits?: { shape: number } }) => string,
): string | null {
  const { seed, kind } = parseBlobShape(shape, name);
  const opts: { size: number; traits?: { shape: number } } = { size };
  if (kind) {
    opts.traits = { shape: BLOB_KIND_TRAIT[kind] ?? 0.5 };
  }
  try {
    return blobatarSvg(seed, opts).replace("<svg ", `<svg data-bot-face=${JSON.stringify(name)} `);
  } catch {
    return null;
  }
}
