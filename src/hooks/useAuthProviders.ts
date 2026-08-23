import { useEffect, useState } from "react";
import {
  fetchAuthProviderAvailability,
  UNRESOLVED_AUTH_PROVIDERS,
  type AuthProviderAvailability,
} from "@/lib/auth-providers";

/**
 * Reads which auth providers this deployment actually supports.
 * Starts unresolved so no provider button ever claims availability it has not
 * verified; SSR renders the unresolved state and the client fills it in.
 */
export function useAuthProviders(active = true): AuthProviderAvailability {
  const [state, setState] = useState<AuthProviderAvailability>(UNRESOLVED_AUTH_PROVIDERS);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let cancelled = false;
    void fetchAuthProviderAvailability(controller.signal).then((value) => {
      if (!cancelled) setState(value);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [active]);

  return state;
}
