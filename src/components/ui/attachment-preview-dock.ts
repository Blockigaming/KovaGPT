import { useSyncExternalStore } from "react";

const desktopPreview = "(min-width: 1024px)";

function subscribe(callback: () => void) {
  const media = window.matchMedia(desktopPreview);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

const noDock = () => null;
const noSubscription = () => () => {};

export function useAttachmentPreviewDock(enabled: boolean, library = false) {
  return useSyncExternalStore(
    enabled ? subscribe : noSubscription,
    enabled
      ? () =>
          window.matchMedia(desktopPreview).matches
            ? document.getElementById(
                library ? "library-attachment-preview-dock" : "chat-attachment-preview-dock",
              )
            : null
      : noDock,
    noDock,
  );
}
