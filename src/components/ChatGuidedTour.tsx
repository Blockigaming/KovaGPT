import { useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const steps = [
  {
    title: "Write a message",
    description: "Ask a question or describe what you want to do.",
    selector: 'textarea[aria-label="Message KovaGPT"]',
  },
  {
    title: "Explore your tools",
    description: "Open Attach to add a file, choose a project, or create an image.",
    selector: 'button[aria-label="Attach"]',
  },
  {
    title: "Choose how Kova responds",
    description: "Use Thinking when you want more reasoning time.",
    selector: 'button[aria-label="Thinking"], button[aria-label^="Choose response effort:"]',
  },
  {
    title: "Meet the sidebar",
    description: "Open the sidebar to find conversations, projects, and Library.",
    selector:
      'button[aria-label="Open menu"], button[aria-label="Open sidebar"], button[aria-label="Expand sidebar"], button[aria-label="Collapse sidebar"]',
  },
] as const;

function visibleTourTarget(selector: string) {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find((element) => {
    const rect = element.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.left < window.innerWidth &&
      getComputedStyle(element).visibility === "visible" &&
      !element.closest('[aria-hidden="true"], [inert]')
    );
  });
}

export function ChatGuidedTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<DOMRect | null>(null);
  const done = step === steps.length;
  const current = steps[step];
  const selector = current?.selector;
  const anchorRef = useMemo(() => ({ current: anchor }), [anchor]);

  useLayoutEffect(() => {
    if (!open || !selector) {
      setAnchor(null);
      setPosition(null);
      return;
    }
    const initial = visibleTourTarget(selector);
    if (initial && window.matchMedia("(max-width: 1023px)").matches) {
      const rect = initial.getBoundingClientRect();
      const viewport = window.visualViewport;
      if (
        rect.top < (viewport?.offsetTop ?? 0) ||
        rect.bottom > (viewport ? viewport.offsetTop + viewport.height : window.innerHeight)
      )
        initial.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    const measure = () => {
      const target = visibleTourTarget(selector);
      setAnchor(target ?? null);
      setPosition(target?.getBoundingClientRect() ?? null);
    };
    const observer = new ResizeObserver(measure);
    if (initial) observer.observe(initial);
    measure();
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, selector]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setStep(0);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="min-h-11">
          Take a quick tour
        </Button>
      </PopoverTrigger>
      {open && anchor && position && (
        <>
          <PopoverAnchor virtualRef={anchorRef} />
          {createPortal(
            <div
              aria-hidden="true"
              data-tour-spotlight
              className="pointer-events-none fixed z-[48] rounded-xl ring-1 ring-foreground/50"
              style={{
                top: position.top - 6,
                left: position.left - 6,
                height: position.height + 12,
                width: position.width + 12,
                boxShadow: "0 0 0 100vmax rgb(0 0 0 / 28%)",
              }}
            />,
            document.body,
          )}
        </>
      )}
      <PopoverContent
        aria-label="KovaGPT quick tour"
        side="top"
        sideOffset={14}
        collisionPadding={12}
        data-kova-notice-id={done ? "tour_finished" : "guided_tour"}
      >
        <div aria-live="polite" className="space-y-1">
          {done ? (
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Check className="size-4" aria-hidden="true" />
              You’re all set
            </h2>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Step {step + 1} of {steps.length}
              </p>
              <h2 className="text-sm font-semibold">{current?.title}</h2>
              <p className="text-sm text-muted-foreground">{current?.description}</p>
            </>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-1">
          {!done && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mr-auto"
              onClick={() => setOpen(false)}
            >
              Skip tour
            </Button>
          )}
          {step > 0 && !done && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={() => (done ? setOpen(false) : setStep(step + 1))}
          >
            {done ? "Finish" : "Next"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
