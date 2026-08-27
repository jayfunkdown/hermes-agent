import { useEffect, useState } from "react";

import { computeKeyboardInset } from "@/lib/keyboard-inset";

export function useMobileKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const update = () => {
      const viewport = window.visualViewport;
      setInset(
        computeKeyboardInset(
          viewport
            ? { height: viewport.height, offsetTop: viewport.offsetTop }
            : null,
          window.innerHeight,
        ),
      );
    };

    update();
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return inset;
}
