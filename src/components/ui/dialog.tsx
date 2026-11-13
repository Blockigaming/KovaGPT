"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "./reference-icons";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    data-slot="dialog-overlay"
    data-ui-reference="chatgpt.dialog.backdrop"
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/40 backdrop-blur-[3px] duration-[var(--kova-motion-standard)] ease-[var(--kova-ease)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:pointer-events-none",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

interface DialogContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  constrainToViewport?: boolean;
  closeLabel?: string;
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, constrainToViewport = true, closeLabel = "Close", ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      data-slot="dialog-content"
      data-ui-reference="chatgpt.dialog.centered"
      data-kova-dialog-surface={constrainToViewport ? "" : undefined}
      ref={ref}
      className={cn(
        "font-[family-name:var(--font-ui)] fixed left-1/2 top-1/2 z-50 flex min-w-0 w-[calc(100%-2rem)] max-w-[450px] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[var(--kova-radius-panel)] border border-border bg-popover p-5 text-popover-foreground shadow-[var(--shadow-floating)] duration-[var(--kova-motion-standard)] ease-[var(--kova-ease)] [overflow-wrap:anywhere] data-[state=closed]:pointer-events-none",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain supports-[height:100dvh]:max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)]",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        data-kova-dialog-close=""
        data-ui-reference="chatgpt.button.icon"
        className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground ring-offset-background cursor-pointer transition-colors duration-[var(--kova-motion-standard)] ease-[var(--kova-ease)] hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
      >
        <X className="h-[18px] w-[18px]" />
        <span className="sr-only">{closeLabel}</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  // Centered headers must not keep the close-button gutter, otherwise the
  // title and icon sit visibly off center inside the dialog.
  const centered = typeof className === "string" && className.includes("text-center");
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col space-y-1.5",
        centered ? "px-6 text-center" : "pr-10 text-left",
        className,
      )}
      {...props}
    />
  );
};
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "mt-1 flex min-w-0 flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&>button]:h-auto [&>button]:min-h-9 [&>button]:min-w-0 [&>button]:max-w-full [&>button]:whitespace-normal [@media(pointer:coarse)]:[&>button]:min-h-11",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    data-slot="dialog-title"
    className={cn(
      "font-[family-name:var(--font-ui)] text-lg font-semibold leading-6 tracking-normal",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    data-slot="dialog-description"
    className={cn("text-sm leading-5 text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
