import { useCallback, useEffect, useLayoutEffect, useState, type SetStateAction } from "react";

type SidebarPreference = {
  key: "kova-mobile-sidebar-open" | "kova-sidebar-open";
  open: boolean;
};

export function useSidebarPreference() {
  const [preference, setPreference] = useState<SidebarPreference | null>(null);

  useLayoutEffect(() => {
    const mobile = window.matchMedia("(max-width: 1023px)");
    const restore = () => {
      const key = mobile.matches ? "kova-mobile-sidebar-open" : "kova-sidebar-open";
      let open = !mobile.matches;
      try {
        const saved = window.localStorage.getItem(key);
        if (saved !== null) open = saved === "1";
      } catch {
        // Keep the viewport default when storage is unavailable.
      }
      setPreference({ key, open });
    };
    restore();
    mobile.addEventListener("change", restore);
    return () => mobile.removeEventListener("change", restore);
  }, []);

  const setOpen = useCallback((next: SetStateAction<boolean>) => {
    setPreference((current) => {
      if (!current || document.querySelector(".kova-settings-dialog")) return current;
      const open = typeof next === "function" ? next(current.open) : next;
      return open === current.open ? current : { ...current, open };
    });
  }, []);

  useEffect(() => {
    // The SSR placeholder must never overwrite a saved open preference.
    if (!preference) return;
    try {
      window.localStorage.setItem(preference.key, preference.open ? "1" : "0");
    } catch {
      // The sidebar remains interactive when storage is unavailable.
    }
  }, [preference]);

  return [preference?.open ?? false, setOpen] as const;
}
