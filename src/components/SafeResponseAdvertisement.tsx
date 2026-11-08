import { lazy, Suspense } from "react";
import { AppErrorBoundary } from "./states";

const Advertisement = lazy(() =>
  import("./ResponseAdvertisement").then(({ ResponseAdvertisement }) => ({
    default: ResponseAdvertisement,
  })),
);

/** Optional monetization must never replace the surrounding conversation. */
export function SafeResponseAdvertisement() {
  return (
    <AppErrorBoundary fallback={() => null}>
      <Suspense fallback={null}>
        <Advertisement />
      </Suspense>
    </AppErrorBoundary>
  );
}
