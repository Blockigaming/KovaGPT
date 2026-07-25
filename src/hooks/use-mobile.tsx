import * as React from "react";

/**
 * Layout breakpoints (CSS pixels):
 *   mobile:  < 768  (phones only — iPhone SE up through Pro Max / large Android)
 *   tablet:  768–1199 (iPad portrait/landscape, small foldables)
 *   desktop: >= 1200 (laptops, standard monitors, wide displays)
 *
 * These are intentional: the user asked that "mobile" mean phones only.
 * Tablets get their own layout mode.
 */
export const PHONE_MAX = 768;
// Tablet upper bound aligns with Tailwind's `lg:` (1024) so mobile/tablet
// shell (drawer sidebar, top bar, bottom sheets) applies consistently below
// desktop, and utility classes prefixed with `lg:` mark the desktop shell.
export const TABLET_MAX = 1024;

export type LayoutMode = "mobile" | "tablet" | "desktop";
export type InteractionMode = "touch" | "pointer";

type NavigatorUAData = {
  mobile?: boolean;
  platform?: string;
};

/** Return true only for real phones (UA signal true and viewport narrow). */
function detectPhoneUA(): boolean | undefined {
  if (typeof navigator === "undefined") return undefined;
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
  if (uaData && typeof uaData.mobile === "boolean") return uaData.mobile;
  const ua = navigator.userAgent || "";
  if (!ua) return undefined;
  // Explicitly exclude iPad / Tablet keywords from the "phone" match.
  if (/iPad|Tablet/i.test(ua)) return false;
  return /Android.*Mobile|iPhone|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

function isIpadLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad/i.test(ua)) return true;
  // iPadOS Safari reports macOS — detect via touch points.
  const maxTouch = (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints ?? 0;
  return /Macintosh/.test(ua) && maxTouch > 1;
}

function computeLayoutMode(): LayoutMode {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  const uaPhone = detectPhoneUA();
  if (uaPhone === true && w < TABLET_MAX) return "mobile";
  if (isIpadLike() && w < TABLET_MAX) return "tablet";
  if (w < PHONE_MAX) return "mobile";
  if (w < TABLET_MAX) return "tablet";
  return "desktop";
}

function computeInteractionMode(): InteractionMode {
  if (typeof window === "undefined") return "pointer";
  if (window.matchMedia("(pointer: coarse)").matches) return "touch";
  return "pointer";
}

/**
 * Central responsive hook. Updates immediately on resize, rotation,
 * Split View / Stage Manager changes, and pointer capability changes.
 */
export function useLayout() {
  const [mode, setMode] = React.useState<LayoutMode>("desktop");
  const [interaction, setInteraction] = React.useState<InteractionMode>("pointer");

  React.useEffect(() => {
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setMode(computeLayoutMode());
        setInteraction(computeInteractionMode());
      });
    };
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    const coarse = window.matchMedia("(pointer: coarse)");
    coarse.addEventListener?.("change", update);
    update();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      coarse.removeEventListener?.("change", update);
    };
  }, []);

  return {
    mode,
    interaction,
    isMobile: mode === "mobile",
    isTablet: mode === "tablet",
    isDesktop: mode === "desktop",
  };
}

/** Back-compat: phones only. Tablets return false. */
export function useIsMobile(): boolean {
  return useLayout().isMobile;
}

export function useIsTablet(): boolean {
  return useLayout().isTablet;
}

export function useIsDesktop(): boolean {
  return useLayout().isDesktop;
}
