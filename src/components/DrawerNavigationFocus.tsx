import { useEffect, useRef, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useUser } from "@/components/auth/ClerkSafe";
import {
  createDrawerNavigationFocusController,
  focusDrawerDestination,
  registerDrawerNavigationFocus,
} from "@/lib/drawer-navigation-focus";

/** Root lifetime carries a mobile-drawer intent across per-page Sidebar unmounts. */
export function DrawerNavigationFocus() {
  const router = useRouter();
  const route = useRouterState({
    select: (state) => ({ href: state.location.href, status: state.status }),
  });
  const { user, isLoaded } = useUser();
  const principal = isLoaded ? (user?.id ?? null) : undefined;
  const principalRef = useRef(principal);
  const controllerRef = useRef<ReturnType<typeof createDrawerNavigationFocusController> | null>(
    null,
  );
  if (principalRef.current !== principal) controllerRef.current?.cancel();
  principalRef.current = principal;
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = createDrawerNavigationFocusController({
      scope: () => ({
        principal: principalRef.current,
        pathname: router.state.location.pathname,
        href: router.state.location.href,
        idle: router.state.status === "idle",
      }),
      activeElement: () => document.activeElement,
      changed: () => setRevision((value) => value + 1),
      afterEffects: (callback) => window.queueMicrotask(callback),
      focus: (intent) => focusDrawerDestination(document, intent),
    });
    controllerRef.current = controller;
    const unregister = registerDrawerNavigationFocus(controller);
    const before = router.subscribe("onBeforeNavigate", (event) =>
      controller.beforeNavigate(event.toLocation.pathname),
    );
    const rendered = router.subscribe("onRendered", (event) =>
      controller.rendered(event.toLocation.pathname),
    );
    const focusMoved = (event: FocusEvent) => {
      if (event.target === document.body || event.target === document.documentElement) return;
      controller.focusMoved(event.target instanceof Element ? event.target : null);
    };
    document.addEventListener("focusin", focusMoved);
    // Capture happens before the initiating click; later interaction cancels the old intent.
    document.addEventListener("pointerdown", controller.cancel, true);
    document.addEventListener("keydown", controller.cancel, true);
    return () => {
      before();
      rendered();
      document.removeEventListener("focusin", focusMoved);
      document.removeEventListener("pointerdown", controller.cancel, true);
      document.removeEventListener("keydown", controller.cancel, true);
      unregister();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [router]);

  useEffect(() => {
    controllerRef.current?.afterCommit();
  }, [revision, route.href, route.status, principal]);
  return null;
}
