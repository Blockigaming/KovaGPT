/**
 * Touch drawer: swipe right from the left edge to open, swipe left to close.
 */
export function isClearSidebarSwipe({ open, dx, dy, elapsedMs }) {
  if (![dx, dy, elapsedMs].every(Number.isFinite)) return false;
  if (elapsedMs < 0 || elapsedMs > 750) return false;
  const horizontal = Math.abs(dx);
  const vertical = Math.abs(dy);
  return (
    horizontal >= 88 && vertical <= 48 && horizontal >= vertical * 2 && (open ? dx < 0 : dx > 0)
  );
}

/** Release distance and velocity after an eligible one-finger horizontal drag. */
export function shouldSettleSidebarSwipe({ open, dx, dy, width, elapsedMs }) {
  if (![dx, dy, width, elapsedMs].every(Number.isFinite) || width <= 0 || elapsedMs < 0)
    return false;
  const forward = open ? -dx : dx;
  if (forward <= 0 || Math.abs(dy) > 48 || forward < Math.abs(dy) * 2) return false;
  return (
    forward >= Math.min(88, width * 0.4) ||
    (forward >= 24 && elapsedMs <= 500 && forward / Math.max(elapsedMs, 1) >= 0.6)
  );
}

/** The mobile drawer follows the finger without hijacking native scroll or text selection. */
export function installInteractiveSidebarSwipe({
  open,
  target,
  drawer,
  scrim,
  isMobile,
  canStart,
  canContinue,
  toggle,
}) {
  let gesture = null;
  const clearVisual = () => {
    delete drawer.dataset.swipeDragging;
    drawer.style.removeProperty("--kova-swipe-distance");
    delete scrim.dataset.swipeDragging;
    scrim.style.removeProperty("--kova-swipe-progress");
  };
  const width = () => Math.max(1, drawer.getBoundingClientRect().width || 320);
  const settle = (commit, elapsedMs = 0) => {
    if (!gesture) return;
    const { active, dx, dy } = gesture;
    gesture = null;
    if (!active) return;
    const change = commit && shouldSettleSidebarSwipe({ open, dx, dy, width: width(), elapsedMs });
    const finalOpen = change ? !open : open;
    const finishDistance = open ? (finalOpen ? 0 : -width()) : finalOpen ? width() : 0;
    void drawer.offsetWidth;
    drawer.dataset.swipeDragging = open ? "settling-closing" : "settling-opening";
    scrim.dataset.swipeDragging = drawer.dataset.swipeDragging;
    drawer.style.setProperty("--kova-swipe-distance", String(finishDistance) + "px");
    scrim.style.setProperty("--kova-swipe-progress", finalOpen ? "1" : "0");
    if (change) toggle();
    // Keep the release animation alive across the React open-state render.
    setTimeout(clearVisual, 280);
  };
  const start = (event) => {
    if (!isMobile() || event.touches.length !== 1 || !canStart(event)) return;
    if (drawer.dataset.swipeDragging?.startsWith("settling")) return;
    const finger = event.touches[0];
    if (!open && finger.clientX > 24) return;
    gesture = {
      id: finger.identifier,
      x: finger.clientX,
      y: finger.clientY,
      time: event.timeStamp,
      dx: 0,
      dy: 0,
      active: false,
    };
  };
  const move = (event) => {
    if (!gesture) return;
    const finger = event.touches[0];
    if (
      !isMobile() ||
      !canContinue(event) ||
      event.touches.length !== 1 ||
      finger.identifier !== gesture.id
    ) {
      settle(false);
      return;
    }
    const dx = finger.clientX - gesture.x;
    const dy = Math.abs(finger.clientY - gesture.y);
    if (dy > 24 && dy > Math.abs(dx)) {
      settle(false);
      return;
    }
    const distance = Math.min(width(), open ? Math.max(0, -dx) : Math.max(0, dx));
    if (!gesture.active && (distance < 8 || distance < dy * 1.5)) return;
    gesture.active = true;
    gesture.dx = dx;
    gesture.dy = dy;
    const progress = distance / width();
    drawer.dataset.swipeDragging = open ? "closing" : "opening";
    drawer.style.setProperty(
      "--kova-swipe-distance",
      String(open ? -distance : distance) + "px",
    );
    scrim.dataset.swipeDragging = drawer.dataset.swipeDragging;
    scrim.style.setProperty("--kova-swipe-progress", String(open ? 1 - progress : progress));
    if (event.cancelable) event.preventDefault();
  };
  const end = (event) => {
    if (!gesture) return;
    const finalFinger = Array.from(event.changedTouches || []).find(
      (touch) => touch.identifier === gesture.id,
    );
    if (finalFinger && gesture.active) {
      gesture.dx = finalFinger.clientX - gesture.x;
      gesture.dy = Math.abs(finalFinger.clientY - gesture.y);
    }
    settle(true, event.timeStamp - gesture.time);
  };
  const cancel = () => settle(false);
  target.addEventListener("touchstart", start, { passive: true });
  target.addEventListener("touchmove", move, { passive: false });
  target.addEventListener("touchend", end, { passive: true });
  target.addEventListener("touchcancel", cancel, { passive: true });
  return () => {
    target.removeEventListener("touchstart", start);
    target.removeEventListener("touchmove", move);
    target.removeEventListener("touchend", end);
    target.removeEventListener("touchcancel", cancel);
    if (gesture?.active) clearVisual();
    gesture = null;
  };
}
