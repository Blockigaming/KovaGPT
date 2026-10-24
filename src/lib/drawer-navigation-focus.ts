export type DrawerFocusScope = {
  principal: string | null | undefined;
  pathname: string;
  href: string;
  idle: boolean;
};
export type DrawerFocusRequest = { destination: string; source: HTMLElement | null };
type Intent = DrawerFocusRequest & {
  principal: string | null;
  sourceHref: string;
  sourceFocus: Element | null;
  rendered: boolean;
  navigationStarted: boolean;
};

/** A one-use focus intent, never persisted and never attached to ordinary route changes. */
export function createDrawerNavigationFocusController(options: {
  scope: () => DrawerFocusScope;
  activeElement: () => Element | null;
  changed: () => void;
  afterEffects: (callback: () => void) => void;
  focus: (intent: Intent) => void;
}) {
  let pending: Intent | null = null;
  let scheduled: Intent | null = null;
  let disposed = false;
  const cancel = () => {
    pending = null;
    scheduled = null;
  };
  return {
    request(request: DrawerFocusRequest) {
      const scope = options.scope();
      if (disposed || scope.principal === undefined) return false;
      pending = {
        ...request,
        principal: scope.principal,
        sourceHref: scope.href,
        sourceFocus: options.activeElement(),
        rendered: false,
        navigationStarted: false,
      };
      scheduled = null;
      options.changed();
      return true;
    },
    focusMoved(target: Element | null) {
      if (pending && target && target !== pending.sourceFocus && !pending.source?.contains(target))
        cancel();
    },
    beforeNavigate(pathname: string) {
      if (!pending) return;
      if (pathname !== pending.destination || pending.navigationStarted) cancel();
      else pending.navigationStarted = true;
    },
    rendered(pathname: string) {
      if (!pending) return;
      if (pathname !== pending.destination) {
        cancel();
        return;
      }
      pending.rendered = true;
      options.changed();
    },
    afterCommit() {
      const intent = pending;
      if (!intent || disposed) return;
      const scope = options.scope();
      if (scope.principal !== intent.principal) {
        cancel();
        return;
      }
      // Same-href chat selection has a React commit but no router onRendered event.
      if (
        !scope.idle ||
        scope.pathname !== intent.destination ||
        (scope.href !== intent.sourceHref && !intent.rendered) ||
        scheduled === intent
      )
        return;
      scheduled = intent;
      // Finish the current passive-effect flush first, preserving destination-owned focus.
      options.afterEffects(() => {
        if (disposed || pending !== intent) return;
        const current = options.scope();
        if (current.principal !== intent.principal || current.pathname !== intent.destination) {
          cancel();
          return;
        }
        if (!current.idle || (current.href !== intent.sourceHref && !intent.rendered)) {
          // A Link can flush this commit before starting same-route navigation.
          // Wait for its next idle/render commit without losing or polling the intent.
          scheduled = null;
          return;
        }
        cancel();
        options.focus(intent);
      });
    },
    cancel,
    dispose() {
      disposed = true;
      cancel();
    },
  };
}

type Controller = ReturnType<typeof createDrawerNavigationFocusController>;
let registered: Controller | null = null;
export function registerDrawerNavigationFocus(controller: Controller) {
  registered = controller;
  return () => {
    if (registered === controller) registered = null;
    controller.dispose();
  };
}
export function requestDrawerNavigationFocus(request: DrawerFocusRequest) {
  return registered?.request(request) ?? false;
}

/** No scrolling, no override of modal focus or a destination's own starting control. */
export function focusDrawerDestination(document: Document, intent: Intent) {
  const visible = (element: HTMLElement) => {
    const bounds = element.getBoundingClientRect();
    const style = document.defaultView?.getComputedStyle(element);
    return (
      element.isConnected &&
      element.getClientRects().length > 0 &&
      bounds.width > 1 &&
      bounds.height > 1 &&
      !element.closest('[inert], [hidden], [aria-hidden="true"]') &&
      style?.visibility !== "hidden" &&
      style?.clipPath?.replace(/\s/g, "") !== "inset(50%)"
    );
  };
  const modal = Array.from(
    document.querySelectorAll<HTMLElement>('[aria-modal="true"], dialog[open]'),
  ).some(visible);
  if (modal) return;
  const main = document.querySelector<HTMLElement>("#main-content");
  if (!main || !visible(main)) return;
  const active = document.activeElement;
  if (
    active &&
    active !== document.body &&
    active !== document.documentElement &&
    active !== intent.sourceFocus &&
    !intent.source?.contains(active)
  )
    return;
  if (active && main.contains(active)) return;
  const candidates = [
    ...main.querySelectorAll<HTMLElement>("h1"),
    ...document.querySelectorAll<HTMLElement>("[data-kova-navigation-heading]"),
    main,
  ];
  const target = candidates.find(visible);
  if (!target) return;
  const temporaryTabIndex = !target.hasAttribute("tabindex") && !target.matches("input, textarea");
  if (temporaryTabIndex) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  if (temporaryTabIndex) {
    if (document.activeElement === target)
      target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
    else target.removeAttribute("tabindex");
  }
}
