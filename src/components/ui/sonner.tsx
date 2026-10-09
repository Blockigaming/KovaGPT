import { Toaster as Sonner } from "sonner";
import { useRouterState } from "@tanstack/react-router";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const assistantRoute = useRouterState({
    select: (state) =>
      state.location.pathname === "/" || /^\/c\/[^/]+\/?$/u.test(state.location.pathname),
  });
  return (
    <Sonner
      className="toaster group"
      position={assistantRoute ? "top-right" : "bottom-right"}
      offset={{ top: "calc(5.25rem + env(safe-area-inset-top))" }}
      closeButton
      duration={4_000}
      visibleToasts={4}
      gap={8}
      mobileOffset={{
        top: "calc(5.25rem + env(safe-area-inset-top))",
        bottom: "calc(1rem + env(safe-area-inset-bottom))",
        left: 8,
        right: 8,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:rounded-xl group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
