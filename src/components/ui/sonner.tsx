import { Toaster as Sonner } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Native Sonner styles own these variables; bind them to the app palette so
// the current light/dark preference applies without a second theme provider.
const toasterStyle = {
  "--width": "360px",
  "--normal-bg": "var(--popover)",
  "--normal-text": "var(--popover-foreground)",
  "--normal-border": "var(--border)",
  "--border-radius": "var(--kova-radius-card)",
  "--normal-bg-hover": "var(--accent)",
  "--normal-border-hover": "var(--border)",
  "--gray2": "var(--accent)",
  "--gray4": "var(--border)",
  "--gray5": "var(--border)",
  "--gray11": "var(--muted-foreground)",
  "--gray12": "var(--popover-foreground)",
} as React.CSSProperties;

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
            "group toast group-[.toaster]:rounded-xl group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "!text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
