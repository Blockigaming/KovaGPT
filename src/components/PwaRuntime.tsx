import { useEffect } from "react";
import { watchInstallPrompt } from "@/lib/pwa/install";
import { useUser } from "@/components/auth/ClerkSafe";
import { registerPwa, setPwaOwner } from "@/lib/pwa/client";
export function PwaRuntime() {
  const { isLoaded, isSignedIn, user } = useUser(),
    ownerId = isLoaded && isSignedIn ? (user?.id ?? null) : null;
  useEffect(watchInstallPrompt, []);
  useEffect(() => {
    const configure = () => {
      void registerPwa().catch(() => {});
      if (isLoaded) void setPwaOwner(ownerId).catch(() => {});
    };
    configure();
    window.addEventListener("online", configure);
    return () => window.removeEventListener("online", configure);
  }, [isLoaded, ownerId]);
  return null;
}
