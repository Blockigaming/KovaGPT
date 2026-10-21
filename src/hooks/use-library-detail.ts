import { useEffect, useRef, useState } from "react";
import { libraryDetailKey, type LibraryDetailSearch } from "@/lib/library-detail";
import { LibraryItemsRequestError, readLibraryItemAtGeneration } from "@/lib/library-items-client";
import type { LibraryItem } from "@/lib/library.functions";

type DetailState = {
  owner: string;
  key: string;
  attempt: number;
  item: LibraryItem | null;
  status: "ready" | "unavailable" | "error";
};

export function useLibraryDetail({
  search,
  ownerId,
  accountLoaded,
  cleared,
}: {
  search: LibraryDetailSearch;
  ownerId: string | null;
  accountLoaded: boolean;
  cleared: boolean;
}) {
  const key = libraryDetailKey(search);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DetailState | null>(null);
  const identity = useRef({ ownerId, key, accountLoaded, cleared });
  identity.current = { ownerId, key, accountLoaded, cleared };

  useEffect(() => {
    setState(null);
    if (!accountLoaded || !ownerId || !key || search.invalidDetail || cleared) return;
    const controller = new AbortController();
    const current = () =>
      !controller.signal.aborted &&
      identity.current.ownerId === ownerId &&
      identity.current.key === key &&
      identity.current.accountLoaded &&
      !identity.current.cleared;
    void readLibraryItemAtGeneration(
      ownerId,
      { id: search.item!, content_generation: search.generation! },
      controller.signal,
    )
      .then((item) => {
        if (current()) setState({ owner: ownerId, key, attempt, item, status: "ready" });
      })
      .catch((error: unknown) => {
        if (current())
          setState({
            owner: ownerId,
            key,
            attempt,
            item: null,
            status:
              error instanceof LibraryItemsRequestError && error.status === 404
                ? "unavailable"
                : "error",
          });
      });
    return () => controller.abort();
  }, [
    accountLoaded,
    ownerId,
    key,
    search.item,
    search.generation,
    search.invalidDetail,
    cleared,
    attempt,
  ]);

  const status = !key
    ? "closed"
    : search.invalidDetail
      ? "invalid"
      : !accountLoaded
        ? "loading"
        : !ownerId
          ? "signed-out"
          : cleared
            ? "cleared"
            : state?.owner === ownerId && state.key === key && state.attempt === attempt
              ? state.status
              : "loading";
  return {
    status,
    item: status === "ready" ? state!.item : null,
    retry: () => setAttempt((previous) => previous + 1),
  };
}
