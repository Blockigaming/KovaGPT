import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, collisionPadding = 8, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      data-ui-reference="chatgpt.popover"
      data-slot="popover-content"
      ref={ref}
      collisionPadding={collisionPadding}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "font-[family-name:var(--font-ui)] z-50 w-72 rounded-[var(--kova-radius-menu)] border border-border bg-popover p-4 text-popover-foreground shadow-[var(--shadow-floating)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=open]:duration-[350ms] data-[state=closed]:duration-200 origin-(--radix-popover-content-transform-origin)",
        "[--kova-overlay-vh:100vh] max-h-[min(var(--radix-popover-content-available-height,var(--kova-overlay-vh)),calc(var(--kova-overlay-vh)-1rem))] max-w-[min(var(--radix-popover-content-available-width,100vw),calc(100vw-1rem))] overflow-y-auto overflow-x-hidden overscroll-contain [overflow-wrap:anywhere] supports-[height:100dvh]:[--kova-overlay-vh:100dvh]",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
