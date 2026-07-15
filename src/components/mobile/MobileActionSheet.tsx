import { type ReactNode } from "react";
import { MobileBottomSheet } from "@/components/MobileBottomSheet";

export type ActionSheetItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  destructive?: boolean;
  onSelect: () => void;
};

/**
 * Native-feeling iOS-style action sheet used to replace desktop
 * DropdownMenus on mobile. Large 48px rows, safe-area aware, dismiss
 * on tap-outside or swipe-down (handled by MobileBottomSheet).
 */
export function MobileActionSheet({
  open,
  onOpenChange,
  title,
  items,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title?: string;
  items: ActionSheetItem[];
}) {
  return (
    <MobileBottomSheet open={open} onOpenChange={onOpenChange} title={title}>
      <div className="flex flex-col gap-0.5 px-1 pb-2">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => {
              onOpenChange(false);
              // Defer to next tick so the sheet close animation starts first.
              setTimeout(() => it.onSelect(), 0);
            }}
            className={`w-full min-h-12 flex items-center gap-3 px-4 py-3 rounded-xl text-[15px] active:bg-accent transition ${
              it.destructive ? "text-destructive" : "text-foreground"
            }`}
          >
            {it.icon && <span className="w-5 h-5 shrink-0 flex items-center justify-center">{it.icon}</span>}
            <span className="flex-1 text-left">{it.label}</span>
          </button>
        ))}
      </div>
    </MobileBottomSheet>
  );
}
