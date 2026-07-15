import { useEffect, useState } from "react";

/**
 * Returns the vertical inset (in CSS px) required to lift a docked
 * composer above the on-screen keyboard on iOS/Android. Uses the
 * VisualViewport API — the only reliable signal for soft-keyboard
 * geometry on mobile Safari.
 *
 * Also mirrors the value onto `--kb-inset` on <html> so purely
 * CSS-driven layouts can react without re-rendering React.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;

    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // layout viewport height minus visual viewport height ≈ keyboard height
        const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        // Ignore tiny deltas (browser UI micro-shifts) to prevent jitter.
        const value = kb > 40 ? kb : 0;
        setInset(value);
        document.documentElement.style.setProperty("--kb-inset", `${value}px`);
      });
    };

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();

    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.documentElement.style.setProperty("--kb-inset", "0px");
    };
  }, []);

  return inset;
}
