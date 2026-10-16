export function DeviceRecoveryStatus({
  loaded = true,
  stored = false,
  dirty,
  error,
  reloadSaved,
  retrySave,
}: {
  loaded?: boolean;
  stored?: boolean;
  dirty: boolean;
  error: string;
  reloadSaved: () => void;
  retrySave: () => void;
}) {
  return (
    <div className="space-y-2 text-sm">
      <p role="status">
        {!loaded
          ? "Loading device recovery…"
          : error
            ? "Device save needs attention"
            : dirty
              ? "Saving on this device…"
              : stored
                ? "Saved on this device"
                : "No local changes"}{" "}
        · Not synced to other devices.
      </p>
      {error && (
        <>
          <p role="alert">{error}</p>
          <button type="button" className="min-h-11 rounded-xl border px-3" onClick={retrySave}>
            Retry device save
          </button>{" "}
          <button
            type="button"
            className="min-h-11 rounded-xl border px-3"
            onClick={() => {
              if (
                window.confirm(
                  "Replace this local draft with the saved device version? Copy or export your draft first.",
                )
              )
                reloadSaved();
            }}
          >
            Load saved version
          </button>
        </>
      )}
    </div>
  );
}
