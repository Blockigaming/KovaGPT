"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

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
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
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
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, constrainToViewport = true, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      data-kova-dialog-surface={constrainToViewport ? "" : undefined}
      ref={ref}
      className={cn(
        // Base + animation shared across viewports
        "fixed z-50 flex flex-col gap-4 border border-border bg-background shadow-xl duration-150",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        // Mobile (<sm): bottom sheet — cap height and scroll body, respect safe areas
        "inset-x-0 bottom-0 top-auto w-full max-w-full rounded-t-2xl rounded-b-none border-b-0 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]",
        "max-h-[92dvh] overflow-y-auto overscroll-contain",
        "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        // sm+ (tablet/desktop/preview iframe): centered modal
        "sm:inset-auto sm:left-[50%] sm:top-[50%] sm:bottom-auto sm:w-[min(92vw,720px)] sm:max-w-[92vw] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-xl sm:border-b sm:p-6 sm:pb-6 sm:max-h-[88dvh]",
        "sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=open]:slide-in-from-bottom-0",
        className,
      )}
      {...props}
    >
      {/* Mobile/tablet drag handle affordance */}
      <div
        aria-hidden
        className="mx-auto mb-1 h-1.5 w-10 rounded-full bg-muted-foreground/30 sm:hidden"
      />
      {children}
      <DialogPrimitive.Close
        data-kova-dialog-close=""
        className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-[var(--kova-radius-compact)] opacity-65 ring-offset-background cursor-pointer transition hover:bg-accent hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none sm:h-10 sm:w-10 data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
      >
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
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
        "flex flex-col space-y-1.5",
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
    className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
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
    className={cn("text-lg font-semibold leading-tight tracking-tight", className)}
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
    className={cn("text-sm text-muted-foreground", className)}
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
