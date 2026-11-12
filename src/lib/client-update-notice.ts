import { publishKovaNotice } from "@/components/KovaNotificationSurface";
import { BUILD_IDENTITY } from "@/lib/build-identity";

export function watchRequiredClientUpdate(signal: AbortSignal) {
  if (signal.aborted || !/^[a-f0-9]{40}$/.test(BUILD_IDENTITY.sha)) return;
  let checkingUpdate = false;
  let updateReported = false;
  const checkRequiredUpdate = async () => {
    if (checkingUpdate || updateReported || !navigator.onLine) return;
    checkingUpdate = true;
    try {
      const response = await fetch("/api/version", {
        cache: "no-store",
        headers: { "X-Kova-Client-Build": BUILD_IDENTITY.sha },
        signal,
      });
      if (!response.ok || response.redirected) return;
      const identity = await response.json();
      if (
        signal.aborted ||
        identity?.updateRequired !== true ||
        typeof identity.sha !== "string" ||
        !/^[a-f0-9]{40}$/.test(identity.sha) ||
        identity.sha === BUILD_IDENTITY.sha
      )
        return;
      updateReported = true;
      publishKovaNotice({
        id: "update_required",
        title: "An app update is required",
        message: "Save anything you’re editing, then reload to use a supported version.",
        confirmed: true,
        primaryLabel: "Reload",
        onPrimary: () => window.location.reload(),
      });
    } catch {
      // A connectivity or version endpoint failure is not evidence of retirement.
    } finally {
      checkingUpdate = false;
    }
  };
  void checkRequiredUpdate();
  window.addEventListener("focus", checkRequiredUpdate);
  window.addEventListener("online", checkRequiredUpdate);
  signal.addEventListener(
    "abort",
    () => {
      window.removeEventListener("focus", checkRequiredUpdate);
      window.removeEventListener("online", checkRequiredUpdate);
    },
    { once: true },
  );
}
