import { paintMathFace, walkMathFaces } from "@/lib/bot-face-math";

declare global {
  interface Window {
    __hbFaceClock?: {
      stop: () => void;
      wake: () => void;
    };
  }
}

export function startFaceClock() {
  if (typeof window === "undefined") return;

  if (window.__hbFaceClock) {
    window.__hbFaceClock.wake();
    return;
  }

  const t0 = performance.now();
  let faces: SVGSVGElement[] = [];
  let lastScan = -Infinity;
  const visibleFaces = new Set<Element>();
  const observedFaces = new Set<Element>();
  const observer =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
          let becameVisible = false;
          for (const entry of entries) {
            if (entry.isIntersecting) {
              visibleFaces.add(entry.target);
              becameVisible = true;
            } else {
              visibleFaces.delete(entry.target);
            }
          }
          if (becameVisible) {
            window.__hbFaceClock?.wake();
          }
        })
      : null;

  const scanFaces = () => {
    faces = walkMathFaces(document, []);
    if (!observer) return;
    const currentFaces = new Set(faces);
    for (const svg of observedFaces) {
      if (!currentFaces.has(svg as SVGSVGElement)) {
        observer.unobserve(svg);
        observedFaces.delete(svg);
        visibleFaces.delete(svg);
      }
    }
    for (const svg of faces) {
      if (!observedFaces.has(svg)) {
        observedFaces.add(svg);
        observer.observe(svg);
      }
    }
  };

  const paint = (now: number) => {
    if (now - lastScan > 1000) {
      scanFaces();
      lastScan = now;
    }
    const t = (now - t0) / 1000;
    const facesToPaint = observer ? [...visibleFaces] : faces;
    for (const svg of facesToPaint) {
      if (svg.isConnected) {
        paintMathFace(svg as SVGSVGElement, t);
      }
    }
  };

  const idle = () => faces.length === 0 || (observer !== null && visibleFaces.size === 0);

  const teardownCaches = () => {
    observer?.disconnect();
    visibleFaces.clear();
    observedFaces.clear();
    faces = [];
    delete window.__hbFaceClock;
  };

  let lastPaint = -Infinity;
  let rafId = 0;
  let dormant = false;
  let stopped = false;

  const tick = (now: number) => {
    if (stopped) return;
    rafId = 0;
    if (!document.hidden && now - lastPaint >= 1000 / 15) {
      paint(now);
      lastPaint = now;
    }
    if (idle()) {
      dormant = true;
      return;
    }
    rafId = window.requestAnimationFrame(tick);
  };

  const wake = () => {
    if (stopped || !dormant) return;
    dormant = false;
    lastScan = -Infinity;
    rafId = window.requestAnimationFrame(tick);
  };

  const stop = () => {
    stopped = true;
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    teardownCaches();
  };

  window.__hbFaceClock = { stop, wake };
  rafId = window.requestAnimationFrame(tick);
}

export function stopFaceClock() {
  window.__hbFaceClock?.stop();
}

// Re-export paint helpers used by BotFace.
export { paintMathFace, walkMathFaces } from "@/lib/bot-face-math";
