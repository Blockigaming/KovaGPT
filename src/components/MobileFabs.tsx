import { Plus, Settings as SettingsIcon } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * Bottom-left floating actions used on phone + tablet. Replaces the old
 * mobile bottom tab bar so the touch experience feels native and unobtrusive.
 */
export function MobileFabs({
  onNewChat,
  onOpenSettings,
}: {
  onNewChat: () => void;
  onOpenSettings: () => void;
}) {
  const isMobile = useIsMobile();
  if (!isMobile) return null;
  return (
    <div
      className="fixed left-3 z-40 flex items-center gap-2"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
    >
      <button
        onClick={onNewChat}
        aria-label="New chat"
        className="inline-flex items-center gap-2 px-4 h-11 rounded-full bg-[color:var(--kova-blue,#3b82f6)] text-white shadow-lg active:scale-95 transition font-medium text-sm"
      >
        <Plus className="w-4 h-4" />
        <span>New chat</span>
      </button>
      <button
        onClick={onOpenSettings}
        aria-label="Settings"
        className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-background/90 border border-border text-foreground shadow-lg active:scale-95 transition backdrop-blur"
      >
        <SettingsIcon className="w-5 h-5" />
      </button>
    </div>
  );
}
