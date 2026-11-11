import { Toaster as Sonner } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Sonner owns delivery, stacking and close-button behavior. Its content uses the
// pinned SDK Alert recipe; the floating background follows the existing palette.
const toasterStyle = {
  "--width": "360px",
  "--normal-bg": "var(--popover)",
  "--normal-text": "var(--popover-foreground)",
  "--normal-border": "var(--border)",
  "--border-radius": "0.75rem",
  "--normal-bg-hover": "var(--accent)",
  "--normal-border-hover": "var(--border)",
  "--gray2": "var(--accent)",
  "--gray4": "var(--border)",
  "--gray5": "var(--border)",
  "--gray11": "var(--muted-foreground)",
  "--gray12": "var(--popover-foreground)",
} as React.CSSProperties;

// The same small ChatGPT pill geometry as Button, overriding native toast actions.
const toastButtonClassName =
  "group-[.toast]:!h-8 group-[.toast]:!rounded-full group-[.toast]:!px-[15.96px] group-[.toast]:!text-sm group-[.toast]:!font-medium group-[.toast]:!leading-5 group-[.toast]:!transition-[background-color,color,border-color,box-shadow,opacity] group-[.toast]:!duration-150 group-[.toast]:!ease-[ease] group-[.toast]:focus-visible:!outline-none group-[.toast]:focus-visible:!ring-2 group-[.toast]:focus-visible:!ring-ring group-[.toast]:focus-visible:!ring-offset-2 group-[.toast]:focus-visible:!ring-offset-background [@media(pointer:coarse)]:!min-h-11";

const Toaster = ({ style, ...props }: ToasterProps) => {
  const mobile = useIsMobile();
  return (
    <Sonner
      className="toaster group"
      position={mobile ? "top-center" : "bottom-right"}
      closeButton
      duration={4_000}
      visibleToasts={4}
      gap={8}
      mobileOffset={{ top: "calc(72px + env(safe-area-inset-top))", left: 16, right: 16 }}
      style={{ ...toasterStyle, ...style }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:!rounded-[0.75rem] group-[.toaster]:!border-0 group-[.toaster]:!p-4 group-[.toaster]:!gap-3 group-[.toaster]:!bg-popover group-[.toaster]:!text-sm group-[.toaster]:!leading-5 group-[.toaster]:!text-popover-foreground group-[.toaster]:!shadow-[inset_0_0_0_1px_rgb(13_13_13/10%)] dark:group-[.toaster]:!shadow-[inset_0_0_0_1px_rgb(255_255_255/12%)] group-[.toaster]:focus-visible:!ring-2 group-[.toaster]:focus-visible:!ring-ring group-[.toaster]:focus-visible:!ring-offset-2 group-[.toaster]:focus-visible:!ring-offset-background",
          icon: "group-[.toast]:!m-0 group-[.toast]:!size-[20px] group-[.toast]:[&_svg]:!m-0 group-[.toast]:[&_svg]:!size-[20px]",
          content: "group-[.toast]:!min-w-0 group-[.toast]:!flex-1 group-[.toast]:!gap-0",
          title: "group-[.toast]:!font-semibold group-[.toast]:!leading-5 [text-wrap:pretty]",
          description:
            "!text-popover-foreground group-[.toast]:!mt-[2px] group-[.toast]:!leading-5 [text-wrap:pretty]",
          actionButton: `${toastButtonClassName} group-[.toast]:!bg-primary group-[.toast]:!text-primary-foreground group-[.toast]:hover:!bg-primary/90`,
          cancelButton: `${toastButtonClassName} group-[.toast]:!bg-secondary group-[.toast]:!text-secondary-foreground group-[.toast]:hover:!bg-secondary/80`,
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
