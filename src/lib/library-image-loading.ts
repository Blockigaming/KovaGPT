const IMAGE_APPROACH_MARGIN = 300;
const MAX_CONCURRENT_IMAGE_SIGNERS = 4;
let activeSigners = 0;
const pendingSigners: Array<() => Promise<void>> = [];

function drainImageSigners() {
  while (activeSigners < MAX_CONCURRENT_IMAGE_SIGNERS && pendingSigners.length > 0) {
    const next = pendingSigners.shift()!;
    activeSigners += 1;
    void next().finally(() => {
      activeSigners -= 1;
      drainImageSigners();
    });
  }
}

/** Bound signing even when many thumbnails become visible in the same frame. */
export function queueLibraryImageSigning<T>(
  sign: () => Promise<T>,
  isCancelled: () => boolean,
): Promise<T | null> {
  return new Promise((resolve, reject) => {
    pendingSigners.push(async () => {
      try {
        resolve(isCancelled() ? null : await sign());
      } catch (error) {
        reject(error);
      }
    });
    drainImageSigners();
  });
}

/** Observe once; browsers without IntersectionObserver still wait for proximity. */
export function observeLibraryImageApproach(element: Element, onApproach: () => void) {
  if (typeof IntersectionObserver !== "undefined") {
    let activated = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (activated || !entries.some((entry) => entry.isIntersecting)) return;
        activated = true;
        observer.disconnect();
        onApproach();
      },
      { rootMargin: `${IMAGE_APPROACH_MARGIN}px` },
    );
    observer.observe(element);
    return () => {
      activated = true;
      observer.disconnect();
    };
  }

  let stopped = false;
  let frame: number | null = null;
  const stop = () => {
    stopped = true;
    window.removeEventListener("scroll", scheduleCheck, true);
    window.removeEventListener("resize", scheduleCheck);
    if (frame !== null) window.cancelAnimationFrame(frame);
  };
  const check = () => {
    frame = null;
    if (stopped) return;
    const rect = element.getBoundingClientRect();
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom >= -IMAGE_APPROACH_MARGIN &&
      rect.top <= window.innerHeight + IMAGE_APPROACH_MARGIN &&
      rect.right >= -IMAGE_APPROACH_MARGIN &&
      rect.left <= window.innerWidth + IMAGE_APPROACH_MARGIN
    ) {
      stop();
      onApproach();
    }
  };
  function scheduleCheck() {
    if (!stopped && frame === null) frame = window.requestAnimationFrame(check);
  }
  // Capture also observes scrolling inside the app's nested scroll containers.
  window.addEventListener("scroll", scheduleCheck, { capture: true, passive: true });
  window.addEventListener("resize", scheduleCheck, { passive: true });
  check();
  return stop;
}
