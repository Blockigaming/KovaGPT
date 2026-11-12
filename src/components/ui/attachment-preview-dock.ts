import { useSyncExternalStore } from "react";

const desktopPreview = "(min-width: 1024px)";

function subscribe(callback: () => void) {
  const media = window.matchMedia(desktopPreview);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function getDock() {
  return window.matchMedia(desktopPreview).matches
    ? document.getElementById("chat-attachment-preview-dock")
    : null;
}

const noDock = () => null;
const noSubscription = () => () => {};

export function useAttachmentPreviewDock(enabled: boolean) {
  return useSyncExternalStore(
    enabled ? subscribe : noSubscription,
    enabled ? getDock : noDock,
    noDock,
  );
}
