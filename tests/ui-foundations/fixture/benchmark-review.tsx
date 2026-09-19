import { useEffect, useRef, useState, type MouseEvent } from "react";
import { PublicFixture } from "./public-pages";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Only the downloadable review uses this boundary. Application routing is unchanged.
export function BenchmarkReview({ initialSurface }: { initialSurface: string }) {
  const [surface, setSurface] = useState(initialSurface);
  const [surfaceRevision, setSurfaceRevision] = useState(0);
  const [destination, setDestination] = useState<string | null>(null);
  const origin = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    // A file URL has an opaque origin. Send only the public surface name.
    if (window.parent !== window)
      window.parent.postMessage({ type: "kova-review-surface", surface }, "*");
  }, [surface]);
  function follow(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>("a[href]");
    const href = link?.getAttribute("href");
    if (!link || !href?.startsWith("/") || href.startsWith("//")) return;
    event.preventDefault();
    event.stopPropagation();
    if (href === "/overview" || href === "/pricing") {
      setSurface(href === "/pricing" ? "public-comparison" : "public-overview");
      // PublicHeader owns its open state. Remount the contained surface so a
      // same-surface selection closes that menu just like a route transition.
      setSurfaceRevision((value) => value + 1);
      requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        document.getElementById("main-content")?.focus({ preventScroll: true });
      });
    } else {
      origin.current = link;
      setDestination(href);
    }
  }
  return (
    <div onClickCapture={follow}>
      <PublicFixture key={`${surface}:${surfaceRevision}`} surface={surface} />
      <Dialog
        open={destination !== null}
        onOpenChange={(open) => {
          if (!open) setDestination(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            origin.current?.focus();
          }}
        >
          <DialogTitle>This destination isn’t in this preview yet</DialogTitle>
          <DialogDescription>
            You selected {destination}. This download includes the overview and pricing comparison
            only. Your place on the page is preserved.
          </DialogDescription>
          <DialogClose asChild>
            <Button>Return to preview</Button>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </div>
  );
}
