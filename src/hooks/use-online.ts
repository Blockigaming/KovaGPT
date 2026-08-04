import { useEffect, useState } from "react";

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let cancelled = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    async function probe(): Promise<boolean> {
      try {
        const response = await fetch("/favicon.png", {
          method: "HEAD",
          cache: "no-store",
          signal: AbortSignal.timeout(4_000),
        });
        return response.ok || response.status < 500;
      } catch {
        return false;
      }
    }
    const offline = () => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const alive = await probe();
        if (!cancelled) setOnline(alive);
      }, 1_500);
    };
    const connected = () => {
      clearTimeout(debounce);
      if (!cancelled) setOnline(true);
    };
    if (navigator.onLine === false) offline();
    window.addEventListener("online", connected);
    window.addEventListener("offline", offline);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", offline);
    };
  }, []);
  return online;
}
