import { useEffect, useRef, useState } from "react";
import {
  createHistoricalLibraryAvailabilityReader,
  type HistoricalLibraryAvailability,
} from "@/lib/historical-library-availability";
import { readHistoricalLibraryAvailability } from "@/lib/historical-library-availability-client";

const reader = createHistoricalLibraryAvailabilityReader(readHistoricalLibraryAvailability);

export function useHistoricalLibraryAvailability(owner: string | null, id: string) {
  const elementRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retryRequested = useRef(false);
  const identity = useRef({ owner, id, generation: 0 });
  if (identity.current.owner !== owner || identity.current.id !== id) {
    identity.current = { owner, id, generation: identity.current.generation + 1 };
    retryRequested.current = false;
  }
  const generation = identity.current.generation;
  const [snapshot, setSnapshot] = useState<{
    generation: number;
    status: HistoricalLibraryAvailability;
  } | null>(null);

  useEffect(() => reader.retainOwner(owner), [owner]);
  useEffect(() => {
    const element = elementRef.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    let active = true;
    const observer = new IntersectionObserver(([entry]) => {
      if (active && entry) setVisible(entry.isIntersecting);
    });
    observer.observe(element);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!owner || (!visible && !retryRequested.current)) return;
    const refresh = retryRequested.current;
    retryRequested.current = false;
    return reader.subscribe(
      owner,
      id,
      (status) => {
        if (identity.current.generation === generation) setSnapshot({ generation, status });
      },
      refresh,
    );
  }, [owner, id, generation, visible, attempt]);

  return {
    elementRef,
    status: owner && snapshot?.generation === generation ? snapshot.status : ("unknown" as const),
    retry: () => {
      retryRequested.current = true;
      setAttempt((previous) => previous + 1);
    },
  };
}
