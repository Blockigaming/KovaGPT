import { useRef } from "react";
import { useUser } from "./auth";

// Only this isolated fixture resolves these aliases. No network or persistence.
export function useTier() {
  return { tier: useUser().isSignedIn ? "pro" : "free", loading: false };
}
export function useServerFn<T>(fn: T): T {
  return fn;
}
export async function isScheduledTasksEligible() {
  return { eligible: false };
}
export function useLibraryAttachmentAutoSave() {
  const scope = useRef({ enabled: false, principal: null });
  return { scope: scope.current, save: async () => undefined };
}
