import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { readAccountProfile, type AccountProfile } from "@/lib/account-profile.functions";

export const ACCOUNT_PROFILE_CHANGED = "kova:account-profile-changed";

export function useAccountProfile(ownerId: string | null) {
  const load = useServerFn(readAccountProfile);
  const [snapshot, setSnapshot] = useState<{
    ownerId: string;
    profile: AccountProfile | null;
    failed: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!ownerId) return;
    let active = true;
    let changed = false;
    const update = (event: Event) => {
      const { ownerId: changedOwner, profile } = (event as CustomEvent).detail;
      if (changedOwner !== ownerId) return;
      changed = true;
      setSnapshot({ ownerId, profile, failed: false });
    };
    window.addEventListener(ACCOUNT_PROFILE_CHANGED, update);
    void load({ data: { ownerId } }).then(
      (profile) => {
        if (active && !changed) setSnapshot({ ownerId, profile, failed: false });
      },
      () => {
        if (active && !changed) setSnapshot({ ownerId, profile: null, failed: true });
      },
    );
    return () => {
      active = false;
      window.removeEventListener(ACCOUNT_PROFILE_CHANGED, update);
    };
  }, [ownerId, load, attempt]);
  const current = snapshot?.ownerId === ownerId ? snapshot : null;
  return {
    profile: current?.profile ?? null,
    loaded: Boolean(current),
    failed: Boolean(current?.failed),
    retry: () => {
      setSnapshot(null);
      setAttempt((value) => value + 1);
    },
  };
}
