import { useEffect, useState } from "react";
import { WORK_STORE_CHANGED_EVENT } from "@/lib/work-sync-state";

export function useWorkStoreRevision(ownerId: string | null) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ ownerId?: string | null }>).detail?.ownerId === ownerId)
        setRevision((value) => value + 1);
    };
    const storage = (event: StorageEvent) => {
      if (ownerId && event.key === `kova-work-sync-v1:user:${encodeURIComponent(ownerId)}`)
        setRevision((value) => value + 1);
    };
    window.addEventListener(WORK_STORE_CHANGED_EVENT, changed);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener(WORK_STORE_CHANGED_EVENT, changed);
      window.removeEventListener("storage", storage);
    };
  }, [ownerId]);
  return revision;
}
