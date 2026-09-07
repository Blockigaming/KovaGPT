import { useEffect } from "react";
import { watchInstallPrompt } from "@/lib/pwa/install";
import { useUser } from "@/components/auth/ClerkSafe";
import { registerPwa, setPwaOwner } from "@/lib/pwa/client";
export function PwaRuntime() {
  const { isLoaded, isSignedIn, user } = useUser(),
    ownerId = isLoaded && isSignedIn ? (user?.id ?? null) : null;
  useEffect(watchInstallPrompt, []);
  useEffect(() => {
    void registerPwa().catch(() => {});
  }, []);
  useEffect(() => {
    if (isLoaded) void setPwaOwner(ownerId).catch(() => {});
  }, [isLoaded, ownerId]);
  return null;
}
