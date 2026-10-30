import * as React from "react";
import * as MenubarPrimitive from "@radix-ui/react-menubar";
import { Check, ChevronRight, Circle } from "./reference-icons";

import { cn } from "@/lib/utils";

function MenubarMenu({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Menu>) {
  return <MenubarPrimitive.Menu {...props} />;
}

function MenubarGroup({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Group>) {
  return <MenubarPrimitive.Group {...props} />;
}

function MenubarPortal({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Portal>) {
  return <MenubarPrimitive.Portal {...props} />;
}

function MenubarRadioGroup({ ...props }: React.ComponentProps<typeof MenubarPrimitive.RadioGroup>) {
  return <MenubarPrimitive.RadioGroup {...props} />;
}

function MenubarSub({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Sub>) {
  return <MenubarPrimitive.Sub data-slot="menubar-sub" {...props} />;
}

const Menubar = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Root
    data-slot="menubar"
    data-ui-reference="chatgpt.menu.toolbar"
    ref={ref}
    className={cn(
      "font-[family-name:var(--font-ui)] flex min-h-9 max-w-full items-center gap-0.5 rounded-[8px] border border-border bg-transparent p-0.5 shadow-none [@media(pointer:coarse)]:min-h-12",
      className,
    )}
    {...props}
  />
));
Menubar.displayName = MenubarPrimitive.Root.displayName;

const MenubarTrigger = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Trigger
    data-slot="menubar-trigger"
    data-ui-reference="chatgpt.button.toggle"
    ref={ref}
    className={cn(
      "flex min-h-8 cursor-pointer select-none items-center rounded-[6px] px-3 py-0 text-sm font-medium outline-none focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground [@media(pointer:coarse)]:min-h-11",
      className,
    )}
    {...props}
  />
));
MenubarTrigger.displayName = MenubarPrimitive.Trigger.displayName;

const MenubarSubTrigger = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(({ className, inset, children, ...props }, ref) => (
  <MenubarPrimitive.SubTrigger
    data-slot="menu-item"
    data-ui-reference="chatgpt.menu"
    ref={ref}
    className={cn(
      "flex min-h-8 min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-sm leading-5 [@media(pointer:coarse)]:min-h-11 outline-none focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
      inset && "pl-8",
      className,
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4" />
  </MenubarPrimitive.SubTrigger>
));
MenubarSubTrigger.displayName = MenubarPrimitive.SubTrigger.displayName;

const MenubarSubContent = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubContent>
>(({ className, collisionPadding = 8, ...props }, ref) => (
  <MenubarPrimitive.SubContent
    data-slot="menu-content"
    data-ui-reference="chatgpt.menu"
    ref={ref}
    collisionPadding={collisionPadding}
    className={cn(
      "font-[family-name:var(--font-ui)] z-50 min-w-[8rem] overflow-y-auto overflow-x-hidden overscroll-contain rounded-[var(--kova-radius-menu)] border border-border bg-popover p-1.5 text-popover-foreground shadow-[var(--shadow-floating)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=open]:duration-[350ms] data-[state=closed]:duration-200 origin-(--radix-menubar-content-transform-origin)",
      "[--kova-overlay-vh:100vh] max-h-[min(var(--radix-menubar-content-available-height,var(--kova-overlay-vh)),calc(var(--kova-overlay-vh)-1rem))] max-w-[min(var(--radix-menubar-content-available-width,100vw),calc(100vw-1rem))] [overflow-wrap:anywhere] supports-[height:100dvh]:[--kova-overlay-vh:100dvh]",
      className,
    )}
    {...props}
  />
));
MenubarSubContent.displayName = MenubarPrimitive.SubContent.displayName;

const MenubarContent = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Content>
>(
  (
    {
      className,
      align = "start",
      alignOffset = -4,
      sideOffset = 8,
      collisionPadding = 8,
      ...props
    },
    ref,
  ) => (
    <MenubarPrimitive.Portal>
      <MenubarPrimitive.Content
        data-slot="menu-content"
        data-ui-reference="chatgpt.menu"
        ref={ref}
        align={align}
        alignOffset={alignOffset}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "font-[family-name:var(--font-ui)] z-50 min-w-[12rem] overflow-y-auto overflow-x-hidden overscroll-contain rounded-[var(--kova-radius-menu)] border border-border bg-popover p-1.5 text-popover-foreground shadow-[var(--shadow-floating)] data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=open]:duration-[350ms] data-[state=closed]:duration-200 origin-(--radix-menubar-content-transform-origin)",
          "[--kova-overlay-vh:100vh] max-h-[min(var(--radix-menubar-content-available-height,var(--kova-overlay-vh)),calc(var(--kova-overlay-vh)-1rem))] max-w-[min(var(--radix-menubar-content-available-width,100vw),calc(100vw-1rem))] [overflow-wrap:anywhere] supports-[height:100dvh]:[--kova-overlay-vh:100dvh]",
          className,
        )}
        {...props}
      />
    </MenubarPrimitive.Portal>
  ),
);
MenubarContent.displayName = MenubarPrimitive.Content.displayName;

const MenubarItem = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Item> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <MenubarPrimitive.Item
    data-slot="menu-item"
    data-ui-reference="chatgpt.menu"
    ref={ref}
    className={cn(
      "relative flex min-h-8 min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-sm leading-5 [@media(pointer:coarse)]:min-h-11 outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      inset && "pl-8",
      className,
    )}
    {...props}
  />
));
MenubarItem.displayName = MenubarPrimitive.Item.displayName;

const MenubarCheckboxItem = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <MenubarPrimitive.CheckboxItem
    data-slot="menu-item"
    data-ui-reference="chatgpt.menu"
    ref={ref}
    className={cn(
      "relative flex min-h-8 min-w-0 cursor-pointer select-none items-center rounded-[6px] py-1.5 pl-8 pr-2 text-sm leading-5 [@media(pointer:coarse)]:min-h-11 outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <MenubarPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </MenubarPrimitive.ItemIndicator>
    </span>
    {children}
  </MenubarPrimitive.CheckboxItem>
));
MenubarCheckboxItem.displayName = MenubarPrimitive.CheckboxItem.displayName;

const MenubarRadioItem = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <MenubarPrimitive.RadioItem
    data-slot="menu-item"
    data-ui-reference="chatgpt.menu"
    ref={ref}
    className={cn(
      "relative flex min-h-8 min-w-0 cursor-pointer select-none items-center rounded-[6px] py-1.5 pl-8 pr-2 text-sm leading-5 [@media(pointer:coarse)]:min-h-11 outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <MenubarPrimitive.ItemIndicator>
        <Circle className="h-4 w-4 fill-current" />
      </MenubarPrimitive.ItemIndicator>
    </span>
    {children}
  </MenubarPrimitive.RadioItem>
));
MenubarRadioItem.displayName = MenubarPrimitive.RadioItem.displayName;

const MenubarLabel = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <MenubarPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-xs font-medium text-muted-foreground",
      inset && "pl-8",
      className,
    )}
    {...props}
  />
));
MenubarLabel.displayName = MenubarPrimitive.Label.displayName;

const MenubarSeparator = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Separator
    ref={ref}
    className={cn("-mx-1.5 my-1.5 h-px bg-border", className)}
    {...props}
  />
));
MenubarSeparator.displayName = MenubarPrimitive.Separator.displayName;

const MenubarShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn("ml-auto text-xs tracking-normal text-muted-foreground", className)}
      {...props}
    />
  );
};
MenubarShortcut.displayname = "MenubarShortcut";

export {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
  MenubarLabel,
  MenubarCheckboxItem,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarPortal,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarGroup,
  MenubarSub,
  MenubarShortcut,
};
