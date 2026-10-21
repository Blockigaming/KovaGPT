import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getMyDailyUsage, type DailyUsageDto } from "@/utils/usage.functions";
import { DAILY_UPLOAD_LIMIT_BY_TIER } from "@/lib/modes";

import { useTier } from "@/hooks/useTier";
type Snapshot = { owner: string; status: "loading" | "ready" | "error"; data?: DailyUsageDto };

/** Read on opening Attach; limits still remain enforced by the server. */
export function ComposerUploadAllowance({ ownerId }: { ownerId: string | null }) {
  const { tier, status: planStatus } = useTier();
  const read = useServerFn(getMyDailyUsage);
  const readRef = useRef(read);
  readRef.current = read;
  const [version, setVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => {
    if (!ownerId) {
      setSnapshot(null);
      return;
    }
    let current = true;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    setSnapshot({ owner: ownerId, status: "loading" });
    void readRef
      .current()
      .then((data) => {
        if (!current) return;
        const reset = Date.parse(data.resetsAt);
        if (
          !Number.isInteger(data.uploads) ||
          data.uploads < 0 ||
          !Number.isFinite(reset) ||
          reset <= Date.now()
        ) {
          setSnapshot({ owner: ownerId, status: "error" });
          return;
        }
        setSnapshot({ owner: ownerId, status: "ready", data });
        expiry = setTimeout(
          () => {
            if (current) setVersion((value) => value + 1);
          },
          Math.min(reset - Date.now(), 2_147_483_647),
        );
      })
      .catch(() => {
        if (current) setSnapshot({ owner: ownerId, status: "error" });
      });
    return () => {
      current = false;
      if (expiry) clearTimeout(expiry);
    };
  }, [ownerId, version]);
  if (!ownerId) return <span>Sign in to upload files.</span>;
  if (!snapshot || snapshot.owner !== ownerId || snapshot.status === "loading")
    return <span role="status">Checking today’s upload allowance…</span>;
  if (snapshot.status === "error" || !snapshot.data)
    return (
      <span className="block">
        Today’s remaining allowance is unavailable. Your files and draft are unchanged.{" "}
        <button
          type="button"
          className="min-h-11 underline"
          onClick={() => setVersion((value) => value + 1)}
        >
          Retry allowance
        </button>
      </span>
    );
  if (planStatus === "loading")
    return <span role="status">Checking your plan’s upload allowance…</span>;
  if (planStatus !== "ready")
    return (
      <span>
        {snapshot.data.uploads} uploads recorded today. Your plan limit is unavailable; the server
        will check it before accepting an upload.
      </span>
    );
  const limit = DAILY_UPLOAD_LIMIT_BY_TIER[tier];
  const reset = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(snapshot.data.resetsAt));
  return (
    <span>
      {Math.max(0, limit - snapshot.data.uploads)} of {limit} uploads remaining today. Resets{" "}
      {reset}. The server checks the allowance again when you upload.
    </span>
  );
}
