import { useCallback, useEffect, useRef, useState } from "react";
import type { CollectionPage } from "./read-bounded-collection";

/** Keep only one content page. History stores cursors, never full records. */
export function useCollectionPager<T>(
  fetchPage: (options: {
    data: { cursor: string | null };
    signal?: AbortSignal;
  }) => Promise<CollectionPage<T>>,
  scope: string | null,
  adopt: (items: T[]) => void,
) {
  const current = useRef({
    scope,
    sequence: 0,
    pageGeneration: 0,
    active: true,
    controller: null as AbortController | null,
  });
  if (current.current.scope !== scope) {
    current.current.active = false;
    current.current.controller?.abort();
    current.current = { scope, sequence: 0, pageGeneration: 0, active: true, controller: null };
  }
  const owner = current.current;
  const [state, setState] = useState({
    owner,
    cursor: null as string | null,
    history: [null] as (string | null)[],
    pageNumber: 1,
    pageGeneration: 0,
    failedPageNumber: null as number | null,
    busy: false,
    error: null as string | null,
    ready: false,
    failedHistory: null as (string | null)[] | null,
  });
  useEffect(() => {
    owner.active = true;
    return () => {
      owner.active = false;
      owner.sequence++;
      owner.controller?.abort();
    };
  }, [owner]);
  const invalidate = useCallback(() => {
    owner.sequence++;
    owner.controller?.abort();
    owner.controller = null;
    if (owner === current.current && owner.active) setState((old) => ({ ...old, busy: false }));
  }, [owner]);
  const request = useCallback(
    async (history: (string | null)[], pageNumber = 1) => {
      owner.controller?.abort();
      const controller = new AbortController();
      owner.controller = controller;
      const sequence = ++owner.sequence;
      setState((old) => ({
        ...(old.owner === owner
          ? old
          : { cursor: null, history: [null], pageNumber: 1, pageGeneration: 0, ready: false }),
        owner,
        busy: true,
        error: null,
        failedHistory: null,
        failedPageNumber: null,
      }));
      try {
        const page = await fetchPage({
          data: { cursor: history[history.length - 1] },
          signal: controller.signal,
        });
        if (
          !owner.active ||
          owner !== current.current ||
          sequence !== owner.sequence ||
          controller.signal.aborted
        )
          throw new DOMException("Collection read cancelled", "AbortError");
        owner.pageGeneration++;
        adopt(page.items);
        setState({
          owner,
          history,
          pageNumber,
          pageGeneration: owner.pageGeneration,
          cursor: page.cursor,
          busy: false,
          error: null,
          ready: true,
          failedHistory: null,
          failedPageNumber: null,
        });
        return page.items;
      } catch (reason) {
        if (owner.active && owner === current.current && sequence === owner.sequence)
          setState((old) => ({
            ...old,
            busy: false,
            failedHistory: history,
            failedPageNumber: pageNumber,
            error:
              reason instanceof Error
                ? reason.message
                : "This page is unavailable. Retry to continue.",
          }));
        throw reason;
      } finally {
        if (sequence === owner.sequence) owner.controller = null;
      }
    },
    [adopt, fetchPage, owner],
  );
  const read = useCallback(() => request([null]), [request]);
  const visible =
    state.owner === owner
      ? state
      : {
          ...state,
          ready: false,
          cursor: null,
          history: [null],
          pageNumber: 1,
          busy: false,
          error: null,
        };
  const move = (history: (string | null)[], pageNumber: number) => {
    if (owner.controller || !owner.active) return;
    void request(history, pageNumber).catch(() => {}); // Error stays visible; the existing page remains intact.
  };
  return {
    read,
    invalidate,
    readCurrent: () => request(visible.history, visible.pageNumber),
    isLoading: () => owner.controller !== null || owner.pageGeneration !== visible.pageGeneration,
    busy: visible.busy,
    error: visible.error,
    page: visible.pageNumber,
    hasNext: visible.ready && visible.cursor !== null,
    hasPrevious: visible.ready && visible.history.length > 1,
    next: () => {
      if (visible.cursor)
        move([...visible.history, visible.cursor].slice(-100), visible.pageNumber + 1);
    },
    previous: () => {
      if (visible.history.length > 1) move(visible.history.slice(0, -1), visible.pageNumber - 1);
    },
    retry: () =>
      move(
        visible.failedHistory ?? visible.history,
        visible.failedPageNumber ?? visible.pageNumber,
      ),
    atHistoryLimit: visible.history.length === 1 && visible.pageNumber > 1,
  };
}
