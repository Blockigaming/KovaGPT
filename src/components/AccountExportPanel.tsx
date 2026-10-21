import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import {
  requestAccountExport,
  AccountExportRequestError,
  type ExportOperation,
} from "@/lib/account-export-client";
import {
  beginExportRequestMarker,
  clearExportRequestMarker,
  readExportRequestMarker,
  exportNeedsPolling,
  exportRequestWaitSeconds,
  exportStatusLabel,
  type AccountExportJob,
  type ExportDownload,
  type ExportRequestMarker,
} from "@/lib/account-export-ui";
import { formatStorageBytes } from "@/lib/storage-display";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "@/lib/principal-browser-storage.mjs";

type ExportState = {
  job: AccountExportJob | null;
  loaded: boolean;
  loading: boolean;
  operation: ExportOperation | null;
  error: string | null;
  marker: ExportRequestMarker;
  download: ExportDownload | null;
  retryAt: number | null;
  cleared: boolean;
  now: number;
};

type ExportFocusHandoff = {
  trigger: HTMLButtonElement;
  target: "status" | "download" | "error";
  ownerId: string;
  lease: AbortController;
  sequence: number;
  url: string;
  cleanup: () => void;
};

function exportErrorMessage(error: unknown) {
  if (!(error instanceof AccountExportRequestError))
    return "Export status could not be checked. Try again.";
  if (error.status === 401) return "Sign in again to check or manage your account export.";
  if (error.status === 403)
    return "This action requires an authorized session and, when requested, a verified email. Complete sign-in or email verification, then check status again.";
  if (error.status === 429)
    return "The export request limit has been reached. Wait until requests are available again.";
  if (error.code === "account_export_processing")
    return "This export is processing and cannot be canceled yet. Wait for its status to change.";
  if (
    error.code === "account_export_delete_failed" ||
    error.code === "account_export_cleanup_finalize_failed"
  )
    return "The export was canceled, but removing its download file is still pending. Retry removal.";
  if (
    error.code === "account_export_download_unavailable" ||
    error.code === "account_export_not_ready"
  )
    return "The export download is unavailable. Refresh its status and try again.";
  return "The operation could not be confirmed. Check the export status before continuing.";
}

export function AccountExportPanel({
  ownerId,
  enabled,
}: {
  ownerId: string | null;
  enabled: boolean;
}) {
  return <AccountExportWorkspace key={ownerId ?? "guest"} ownerId={ownerId} enabled={enabled} />;
}

function AccountExportWorkspace({
  ownerId,
  enabled,
}: {
  ownerId: string | null;
  enabled: boolean;
}) {
  const [state, setState] = useState<ExportState>(() => ({
    job: null,
    loaded: false,
    loading: false,
    operation: null,
    error: null,
    marker: { kind: "none" },
    download: null,
    retryAt: null,
    cleared: false,
    now: Date.now(),
  }));
  const stateRef = useRef(state);
  stateRef.current = state;
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const active = useRef({ ownerId, enabled });
  active.current = { ownerId, enabled };
  const lifetime = useRef<AbortController | null>(null);
  const readController = useRef<AbortController | null>(null);
  const readSequence = useRef(0);
  const busy = useRef(false);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusAction = useRef<() => void>(() => {});
  const requestButton = useRef<HTMLButtonElement | null>(null);
  const prepareButton = useRef<HTMLButtonElement | null>(null);
  const refreshButton = useRef<HTMLButtonElement | null>(null);
  const statusRegion = useRef<HTMLDivElement | null>(null);
  const downloadLink = useRef<HTMLAnchorElement | null>(null);
  const errorRegion = useRef<HTMLParagraphElement | null>(null);
  const focusHandoff = useRef<ExportFocusHandoff | null>(null);

  const clearFocusHandoff = useCallback(() => {
    focusHandoff.current?.cleanup();
    focusHandoff.current = null;
  }, []);
  const captureFocusHandoff = useCallback(
    (
      operation: "request" | "cancel" | "download" | "status",
      lease: AbortController,
      failed = false,
    ) => {
      clearFocusHandoff();
      const trigger =
        operation === "request"
          ? requestButton.current
          : operation === "status"
            ? refreshButton.current
            : prepareButton.current;
      if (
        operation === "cancel" ||
        !ownerId ||
        typeof document === "undefined" ||
        !trigger ||
        document.activeElement !== trigger
      )
        return;
      // Listen immediately, before the async operation, including moves that later return to body.
      const focusMoved = (event: FocusEvent) => {
        if (event.target !== trigger && event.target !== document.body) clearFocusHandoff();
      };
      document.addEventListener("focusin", focusMoved);
      document.addEventListener("pointerdown", clearFocusHandoff);
      document.addEventListener("keydown", clearFocusHandoff);
      window.addEventListener("popstate", clearFocusHandoff);
      window.addEventListener("hashchange", clearFocusHandoff);
      window.addEventListener("pagehide", clearFocusHandoff);
      window.addEventListener("blur", clearFocusHandoff);
      focusHandoff.current = {
        trigger,
        target: failed
          ? "error"
          : operation === "request" || operation === "status"
            ? "status"
            : "download",
        ownerId,
        lease,
        sequence: readSequence.current,
        url: window.location.href,
        cleanup: () => {
          document.removeEventListener("focusin", focusMoved);
          document.removeEventListener("pointerdown", clearFocusHandoff);
          document.removeEventListener("keydown", clearFocusHandoff);
          window.removeEventListener("popstate", clearFocusHandoff);
          window.removeEventListener("hashchange", clearFocusHandoff);
          window.removeEventListener("pagehide", clearFocusHandoff);
          window.removeEventListener("blur", clearFocusHandoff);
        },
      };
    },
    [ownerId, clearFocusHandoff],
  );

  useEffect(() => {
    const handoff = focusHandoff.current;
    if (!handoff || state.operation || state.loading) return;
    clearFocusHandoff();
    if (
      !enabled ||
      state.cleared ||
      active.current.ownerId !== handoff.ownerId ||
      !active.current.enabled ||
      lifetime.current !== handoff.lease ||
      handoff.lease.signal.aborted ||
      readSequence.current !== handoff.sequence ||
      window.location.href !== handoff.url ||
      (document.activeElement !== handoff.trigger && document.activeElement !== document.body)
    )
      return;
    const target = state.error
      ? handoff.trigger.isConnected && !handoff.trigger.matches(":disabled")
        ? handoff.trigger
        : errorRegion.current
      : handoff.target === "download"
        ? state.download && state.download.expiresAt > Date.now()
          ? downloadLink.current
          : null
        : handoff.target === "status"
          ? statusRegion.current
          : errorRegion.current;
    if (
      target?.isConnected &&
      target.getClientRects().length &&
      !target.closest('[inert], [aria-hidden="true"]') &&
      !target.matches(":disabled")
    )
      target.focus({ preventScroll: true });
  }, [enabled, state, clearFocusHandoff]);

  const commit = useCallback((patch: Partial<ExportState>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    setState(stateRef.current);
  }, []);
  const stopPolling = useCallback(() => {
    if (poll.current !== null) clearTimeout(poll.current);
    poll.current = null;
  }, []);
  const scheduleStatus = useCallback(
    (retryAfter?: number | null) => {
      stopPolling();
      if (!exportNeedsPolling(stateRef.current.job, stateRef.current.marker)) return;
      poll.current = setTimeout(
        () => statusAction.current(),
        Math.max(5000, (retryAfter ?? 5) * 1000),
      );
    },
    [stopPolling],
  );
  const applyJob = useCallback(
    (job: AccountExportJob | null) => {
      let marker = stateRef.current.marker;
      // A null/unchanged latest job cannot prove that a timed-out POST was rejected.
      if (ownerId && job && marker.kind === "pending" && job.id !== marker.previousJobId)
        marker = clearExportRequestMarker(ownerId);
      commit({
        job,
        marker,
        loaded: true,
        loading: false,
        error: null,
        download: null,
        now: Date.now(),
      });
    },
    [ownerId, commit],
  );

  const loadStatus = useCallback(
    async (manual = false) => {
      const lease = lifetime.current;
      if (
        !ownerId ||
        !enabled ||
        !lease ||
        lease.signal.aborted ||
        busy.current ||
        stateRef.current.cleared
      )
        return;
      clearFocusHandoff();
      stopPolling();
      readController.current?.abort();
      const controller = new AbortController();
      readController.current = controller;
      const sequence = ++readSequence.current;
      if (manual) captureFocusHandoff("status", lease);
      const signal = AbortSignal.any([controller.signal, lease.signal]);
      const current = () =>
        !signal.aborted &&
        lifetime.current === lease &&
        sequence === readSequence.current &&
        active.current.ownerId === ownerId &&
        active.current.enabled;
      const storedMarker = readExportRequestMarker(ownerId);
      commit({
        loading: true,
        error: null,
        download: null,
        marker:
          stateRef.current.marker.kind === "pending" && storedMarker.kind === "none"
            ? stateRef.current.marker
            : storedMarker,
      });
      try {
        const result = await requestAccountExport(ownerId, "status", signal);
        if (!current()) return;
        applyJob(result.job);
        scheduleStatus(result.retryAfter);
      } catch (error) {
        if (current()) commit({ loading: false, error: exportErrorMessage(error) });
      }
    },
    [
      ownerId,
      enabled,
      commit,
      applyJob,
      scheduleStatus,
      stopPolling,
      clearFocusHandoff,
      captureFocusHandoff,
    ],
  );
  statusAction.current = () => void loadStatus();

  useEffect(() => {
    if (!enabled || !ownerId) return;
    const controller = new AbortController();
    lifetime.current = controller;
    busy.current = false;
    commit({
      marker: readExportRequestMarker(ownerId),
      cleared: false,
      operation: null,
      download: null,
    });
    void loadStatus();
    const cleared = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, ownerId)) return;
      controller.abort();
      clearFocusHandoff();
      readController.current?.abort();
      stopPolling();
      setConfirmId(null);
      commit({
        job: null,
        loaded: false,
        loading: false,
        operation: null,
        download: null,
        cleared: true,
        error: null,
      });
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, cleared);
    return () => {
      controller.abort();
      clearFocusHandoff();
      readController.current?.abort();
      stopPolling();
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, cleared);
    };
  }, [ownerId, enabled, loadStatus, commit, stopPolling, clearFocusHandoff]);

  useEffect(() => {
    if (!enabled) return;
    const now = Date.now();
    const wait = exportRequestWaitSeconds(state.job, now);
    const deadlines = [
      state.retryAt,
      wait !== null && wait > 0 ? now + wait * 1000 : null,
      state.download?.expiresAt,
      state.job?.expiresAt ? Date.parse(state.job.expiresAt) : null,
    ].filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value) && value > now,
    );
    if (!deadlines.length) return;
    const timer = setTimeout(
      () => {
        const current = Date.now();
        commit({
          now: current,
          download:
            stateRef.current.download && stateRef.current.download.expiresAt > current
              ? stateRef.current.download
              : null,
        });
      },
      Math.min(2147483647, Math.max(1, Math.min(...deadlines) - now)),
    );
    return () => clearTimeout(timer);
  }, [enabled, state.retryAt, state.download, state.job, state.now, commit]);

  const run = async (operation: "request" | "cancel" | "download", jobId?: string) => {
    const lease = lifetime.current;
    if (
      !ownerId ||
      !enabled ||
      !lease ||
      lease.signal.aborted ||
      busy.current ||
      stateRef.current.cleared
    )
      return;
    const current = () =>
      lifetime.current === lease &&
      !lease.signal.aborted &&
      active.current.ownerId === ownerId &&
      active.current.enabled;
    if (operation === "request") {
      const snapshot = stateRef.current;
      const wait = exportRequestWaitSeconds(snapshot.job);
      if (
        !snapshot.loaded ||
        snapshot.error ||
        snapshot.loading ||
        snapshot.marker.kind !== "none" ||
        wait === null ||
        wait > 0 ||
        (snapshot.retryAt !== null && snapshot.retryAt > Date.now()) ||
        snapshot.job?.status === "queued" ||
        snapshot.job?.status === "processing" ||
        snapshot.job?.cleanupPending
      )
        return;
      const started = beginExportRequestMarker(ownerId, snapshot.job?.id ?? null);
      commit({ marker: started.marker });
      if (!started.created) {
        captureFocusHandoff(operation, lease, true);
        commit({
          error:
            started.marker.kind === "pending"
              ? "An earlier export request is still being checked. Refresh its status before continuing."
              : "This browser could not safely track the export request. Allow session storage before requesting an export.",
        });
        return;
      }
    } else if (
      !jobId ||
      stateRef.current.job?.id !== jobId ||
      stateRef.current.marker.kind === "pending"
    )
      return;
    busy.current = true;
    stopPolling();
    readSequence.current++;
    readController.current?.abort();
    captureFocusHandoff(operation, lease);
    commit({ operation, loading: false, error: null, download: null });
    try {
      const result = await requestAccountExport(ownerId, operation, lease.signal, jobId);
      if (!current()) return;
      if (operation === "request") commit({ marker: clearExportRequestMarker(ownerId) });
      applyJob(result.job);
      if (operation === "download") commit({ download: result.download ?? null });
      scheduleStatus(result.retryAfter);
    } catch (error) {
      if (!current()) return;
      if (
        operation === "request" &&
        error instanceof AccountExportRequestError &&
        error.definitelyRejected
      )
        commit({ marker: clearExportRequestMarker(ownerId) });
      if (error instanceof AccountExportRequestError && error.job) applyJob(error.job);
      commit({
        error: exportErrorMessage(error),
        ...(error instanceof AccountExportRequestError &&
        error.status === 429 &&
        error.retryAfter !== null
          ? { retryAt: Date.now() + error.retryAfter * 1000 }
          : {}),
      });
      // Only status GETs run automatically, including after indeterminate mutations.
      if (operation !== "download")
        scheduleStatus(error instanceof AccountExportRequestError ? error.retryAfter : null);
    } finally {
      if (current()) {
        busy.current = false;
        commit({ operation: null });
      }
    }
  };

  if (!enabled) return null;
  if (!ownerId)
    return (
      <section className="rounded-lg border border-border p-4">
        <h4 className="text-sm font-medium">Account data export</h4>
        <p className="mt-2 text-xs text-muted-foreground">
          Sign in to request or download an export of your cloud account records.
        </p>
      </section>
    );
  const job = state.job;
  const wait = exportRequestWaitSeconds(job, state.now);
  const activeJob = job?.status === "queued" || job?.status === "processing";
  const blocked = !enabled || state.cleared || Boolean(state.operation) || state.loading;
  const downloadable = job?.downloadable && job.expiresAt && Date.parse(job.expiresAt) > state.now;
  const availableAt = Math.max(
    state.retryAt ?? 0,
    wait !== null && wait > 0 ? state.now + wait * 1000 : 0,
  );
  return (
    <section
      className="min-w-0 space-y-3 rounded-lg border border-border p-4 [overflow-wrap:anywhere]"
      aria-label="Account data export"
    >
      <div>
        <h4 className="text-sm font-medium">Account data export</h4>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Request a downloadable copy of supported cloud account records. This is separate from the
          chats and preferences stored on this device.
        </p>
      </div>
      {state.cleared ? (
        <p role="status" className="text-sm">
          Account data was cleared from this browser. Reopen Privacy settings to check your export
          again.
        </p>
      ) : (
        <>
          <div
            ref={statusRegion}
            role="status"
            aria-label="Account export status"
            aria-live="polite"
            tabIndex={-1}
            className="space-y-2 text-sm"
          >
            {!state.loaded ? (
              state.loading ? (
                "Checking export status…"
              ) : (
                "Export status unavailable"
              )
            ) : job ? (
              <>
                <p>
                  Latest export:{" "}
                  <span className="font-medium">{exportStatusLabel(job, state.now)}</span>
                </p>
                {job.requestedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Requested{" "}
                    <time dateTime={job.requestedAt}>
                      {new Date(job.requestedAt).toLocaleString()}
                    </time>
                  </p>
                ) : null}
                {job.completedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Completed{" "}
                    <time dateTime={job.completedAt}>
                      {new Date(job.completedAt).toLocaleString()}
                    </time>
                  </p>
                ) : null}
                {job.expiresAt ? (
                  <p className="text-xs text-muted-foreground">
                    Download expires{" "}
                    <time dateTime={job.expiresAt}>{new Date(job.expiresAt).toLocaleString()}</time>
                  </p>
                ) : null}
                {job.sizeBytes !== null ? (
                  <p className="text-xs text-muted-foreground">
                    File size: {formatStorageBytes(job.sizeBytes)}
                  </p>
                ) : null}
                {activeJob ? (
                  <p className="text-xs text-muted-foreground">
                    Status refreshes while this section is open. The service does not provide a
                    progress percentage or completion estimate.
                  </p>
                ) : null}
                {job.status === "failed" ? (
                  <p>
                    The export failed. You can request another export when requests become
                    available.
                  </p>
                ) : null}
                {job.cleanupPending ? (
                  <p>
                    Removal of the export file is still pending. Account records are unaffected.
                  </p>
                ) : null}
              </>
            ) : (
              "No previous account export was found."
            )}
          </div>
          {state.marker.kind === "pending" ? (
            <p role="status" className="text-sm">
              The previous request has not been confirmed. Only its status will be checked; another
              export request will not be sent.
            </p>
          ) : null}
          {state.marker.kind === "unavailable" ? (
            <p role="alert" className="text-sm text-destructive">
              Request tracking is unavailable in this browser. New export requests are disabled to
              prevent an unconfirmed request from being repeated.
            </p>
          ) : null}
          {state.error ? (
            <p ref={errorRegion} role="alert" tabIndex={-1} className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
          {availableAt > state.now && !activeJob ? (
            <p className="text-xs text-muted-foreground">
              Another request is available after{" "}
              <time dateTime={new Date(availableAt).toISOString()}>
                {new Date(availableAt).toLocaleString()}
              </time>
              .
            </p>
          ) : null}
          {state.loaded && job && wait === null && !activeJob ? (
            <p className="text-xs text-muted-foreground">
              Request availability could not be determined from this export. Refresh its status
              before requesting another.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="min-h-11"
              disabled={blocked}
              ref={refreshButton}
              onClick={() => void loadStatus(true)}
            >
              {state.loading ? "Checking status…" : "Refresh export status"}
            </Button>
            {!activeJob && !job?.cleanupPending ? (
              <Button
                ref={requestButton}
                className="min-h-11"
                disabled={
                  blocked ||
                  !state.loaded ||
                  Boolean(state.error) ||
                  state.marker.kind !== "none" ||
                  wait === null ||
                  wait > 0 ||
                  availableAt > state.now
                }
                onClick={() => void run("request")}
              >
                {state.operation === "request"
                  ? "Requesting…"
                  : job
                    ? "Request new account export"
                    : "Request account export"}
              </Button>
            ) : null}
            {downloadable && !state.download ? (
              <Button
                ref={prepareButton}
                variant="outline"
                className="min-h-11"
                disabled={blocked || state.marker.kind === "pending"}
                onClick={() => void run("download", job!.id)}
              >
                {state.operation === "download"
                  ? "Checking download access…"
                  : "Prepare account download"}
              </Button>
            ) : null}
            {state.download && state.download.expiresAt > state.now ? (
              <a
                ref={downloadLink}
                className="kova-button inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm underline"
                href={state.download.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => {
                  if (
                    !active.current.enabled ||
                    active.current.ownerId !== ownerId ||
                    lifetime.current?.signal.aborted ||
                    state.download!.expiresAt <= Date.now()
                  )
                    event.preventDefault();
                }}
              >
                Download account export
              </a>
            ) : null}
            {job &&
            job.status !== "processing" &&
            (job.status !== "canceled" || job.cleanupPending) ? (
              <Button
                variant="outline"
                className="min-h-11"
                disabled={blocked || state.marker.kind === "pending"}
                onClick={() => setConfirmId(job.id)}
              >
                {job.cleanupPending
                  ? "Retry export removal"
                  : job.status === "queued"
                    ? "Cancel queued export"
                    : "Remove export file"}
              </Button>
            ) : null}
          </div>
          {state.download ? (
            <p className="text-xs text-muted-foreground">
              Download link ready.{" "}
              {state.download.requiresSession
                ? "Your active signed-in session is required when the file is opened."
                : "This private download link is short-lived."}
            </p>
          ) : null}
        </>
      )}
      <ConfirmActionDialog
        open={confirmId !== null}
        onOpenChange={(open) => !open && setConfirmId(null)}
        title="Remove this account export?"
        description="Cancel this queued export or remove its downloadable file. This does not delete your account records. A processing export cannot be canceled until its status changes."
        confirmLabel="Remove export"
        destructive
        disabled={blocked || state.marker.kind === "pending"}
        onConfirm={() => {
          const id = confirmId;
          setConfirmId(null);
          if (id) void run("cancel", id);
        }}
      />
    </section>
  );
}
