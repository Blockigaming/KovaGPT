/**
 * ChatGPT mobile parity: no floating action buttons.
 * New-chat lives in the top bar (right icon) and Settings lives inside the
 * sidebar. This component is intentionally a no-op; the export is preserved
 * so existing imports keep working without an edit sweep.
 */
export function MobileFabs(_props: {
  onNewChat: () => void;
  onOpenSettings: () => void;
}) {
  return null;
}

