import * as React from "react";

const MOBILE_BREAKPOINT = 768;

type NavigatorUAData = {
  mobile?: boolean;
  platform?: string;
};

function detectMobileFromUA(): boolean | undefined {
  if (typeof navigator === "undefined") return undefined;
  // Prefer modern Client Hints (User-Agent Client Hints) when available.
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
  if (uaData && typeof uaData.mobile === "boolean") return uaData.mobile;
  // Fall back to the classic User-Agent string.
  const ua = navigator.userAgent || "";
  if (!ua) return undefined;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(ua);
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const compute = () => {
      // Combine the User-Agent / Client Hints signal with the viewport size so
      // the mobile UI kicks in on real phones/tablets AND on narrow desktop
      // windows, and the desktop UI kicks in on wide tablets/desktops.
      const uaMobile = detectMobileFromUA();
      const narrow = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(uaMobile === true ? true : uaMobile === false ? narrow : narrow);
    };
    mql.addEventListener("change", compute);
    window.addEventListener("resize", compute);
    compute();
    return () => {
      mql.removeEventListener("change", compute);
      window.removeEventListener("resize", compute);
    };
  }, []);

  return !!isMobile;
}

