import { useCallback, useEffect, useLayoutEffect, useState, type SetStateAction } from "react";

type SidebarPreference = {
  pinned: boolean;
  open: boolean;
};

export function useSidebarPreference() {
  const [preference, setPreference] = useState<SidebarPreference | null>(null);

  useLayoutEffect(() => {
    const mobile = window.matchMedia("(max-width: 1023px)");
    const restore = () => {
      const pinned = !mobile.matches;
      let open = pinned;
      if (pinned) {
        try {
          const saved = window.localStorage.getItem("kova-sidebar-open");
          if (saved !== null) open = saved === "1";
        } catch {
          // Keep the viewport default when storage is unavailable.
        }
      }
      setPreference({ pinned, open });
    };
    restore();
    mobile.addEventListener("change", restore);
    return () => mobile.removeEventListener("change", restore);
  }, []);

  const setOpen = useCallback((next: SetStateAction<boolean>) => {
    // Preserve the background navigation while Settings owns interaction.
    if (typeof document !== "undefined" && document.querySelector('[data-settings-open="true"]'))
      return;
    setPreference((current) => {
      if (!current || document.querySelector(".kova-settings-dialog")) return current;
      const open = typeof next === "function" ? next(current.open) : next;
      return open === current.open ? current : { ...current, open };
    });
  }, []);

  useEffect(() => {
    // The SSR placeholder must never overwrite a saved open preference.
    if (!preference?.pinned) return;
    try {
      window.localStorage.setItem("kova-sidebar-open", preference.open ? "1" : "0");
    } catch {
      // The sidebar remains interactive when storage is unavailable.
    }
  }, [preference]);

  return [preference?.open ?? false, setOpen] as const;
}
