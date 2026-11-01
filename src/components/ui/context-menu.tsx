import * as React from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { Check, ChevronRight } from "./reference-icons";

import { cn } from "@/lib/utils";

const ContextMenu = ContextMenuPrimitive.Root;

const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

const ContextMenuGroup = ContextMenuPrimitive.Group;

const ContextMenuPortal = ContextMenuPrimitive.Portal;

const ContextMenuSub = ContextMenuPrimitive.Sub;

const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

// Popper updates available width during placement. Animate opacity/scale only;
// transitioning that measured width can clip the first visible menu frame.
const ContextMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(({ className, inset, children, ...props }, ref) => (
  <ContextMenuPrimitive.SubTrigger
    data-slot="menu-item"
    data-ui-reference="chatgpt.menu"
    ref={ref}
    className={cn(
      "flex min-h-8 min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-xl px-2 py-1.5 text-sm leading-5 [@media(pointer:coarse)]:min-h-11 outline-none focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
      inset && "pl-8",
      className,
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4" />
  </ContextMenuPrimitive.SubTrigger>
));
ContextMenuSubTrigger.displayName = ContextMenuPrimitive.SubTrigger.displayName;

const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(({ className, collisionPadding = 8, ...props }, ref) => (
  <ContextMenuPrimitive.SubContent
    data-slot="menu-content"
    data-ui-reference="chatgpt.menu"
    ref={ref}
    collisionPadding={collisionPadding}
    className={cn(
      "font-[family-name:var(--font-ui)] z-50 min-w-[min(8rem,var(--radix-context-menu-content-available-width,100vw))] rounded-[var(--kova-radius-menu)] border border-border bg-popover p-1.5 text-popover-foreground shadow-[var(--shadow-floating)] transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=open]:[animation-duration:350ms] data-[state=closed]:[animation-duration:200ms] origin-(--radix-context-menu-content-transform-origin)",
      "[--kova-overlay-vh:100vh] max-h-[min(var(--radix-context-menu-content-available-height,var(--kova-overlay-vh)),calc(var(--kova-overlay-vh)-1rem))] max-w-[min(var(--radix-context-menu-content-available-width,100vw),calc(100vw-1rem))] overflow-y-auto overflow-x-hidden overscroll-contain [overflow-wrap:anywhere] supports-[height:100dvh]:[--kova-overlay-vh:100dvh]",
      className,
    )}
    {...props}
  />
));
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName;

const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, collisionPadding = 8, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      data-slot="menu-content"
      data-ui-reference="chatgpt.menu"
      ref={ref}
      collisionPadding={collisionPadding}
      className={cn(
        "font-[family-name:var(--font-ui)] z-50 min-w-[min(8rem,var(--radix-context-menu-content-available-width,100vw))] rounded-[var(--kova-radius-menu)] border border-border bg-popover p-1.5 text-popover-foreground shadow-[var(--shadow-floating)] transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=open]:[animation-duration:350ms] data-[state=closed]:[animation-duration:200ms] origin-(--radix-context-menu-content-transform-origin)",
        "[--kova-overlay-vh:100vh] max-h-[min(var(--radix-context-menu-content-available-height,var(--kova-overlay-vh)),calc(var(--kova-overlay-vh)-1rem))] max-w-[min(var(--radix-context-menu-content-available-width,100vw),calc(100vw-1rem))] overflow-y-auto overflow-x-hidden overscroll-contain [overflow-wrap:anywhere] supports-[height:100dvh]:[--kova-overlay-vh:100dvh]",
        className,
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;

const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    data-slot="menu-item"
    data-ui-reference="chatgpt.menu"
    ref={ref}
    className={cn(
      "relative flex min-h-8 min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-xl px-2 py-1.5 text-sm leading-5 [@media(pointer:coarse)]:min-h-11 outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      inset && "pl-8",
      className,
    )}
    {...props}
  />
));
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;

const ContextMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <ContextMenuPrimitive.CheckboxItem
    data-slot="menu-item"
    data-ui-reference="chatgpt.menu"
    ref={ref}
    className={cn(
      "relative flex min-h-8 min-w-0 cursor-pointer select-none items-center rounded-xl py-1.5 pl-8 pr-2 text-sm leading-5 [@media(pointer:coarse)]:min-h-11 outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.CheckboxItem>
));
ContextMenuCheckboxItem.displayName = ContextMenuPrimitive.CheckboxItem.displayName;

const ContextMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.RadioItem
    data-slot="menu-item"
    data-ui-reference="chatgpt.menu"
    ref={ref}
    className={cn(
      "relative flex min-h-8 min-w-0 cursor-pointer select-none items-center rounded-xl py-1.5 pl-8 pr-2 text-sm leading-5 [@media(pointer:coarse)]:min-h-11 outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" aria-hidden="true" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.RadioItem>
));
ContextMenuRadioItem.displayName = ContextMenuPrimitive.RadioItem.displayName;

const ContextMenuLabel = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-xs font-medium text-muted-foreground",
      inset && "pl-8",
      className,
    )}
    {...props}
  />
));
ContextMenuLabel.displayName = ContextMenuPrimitive.Label.displayName;

const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1.5 my-1.5 h-px bg-border", className)}
    {...props}
  />
));
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName;

const ContextMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn("ml-auto text-xs tracking-normal text-muted-foreground", className)}
      {...props}
    />
  );
};
ContextMenuShortcut.displayName = "ContextMenuShortcut";

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
};
