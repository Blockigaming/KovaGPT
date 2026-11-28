import { useRef, type TouchEvent } from "react";

type Point = { x: number; y: number };
type Gesture = { center: Point; distance: number; moved: boolean };

function touchGeometry(touches: React.TouchList) {
  const first = touches.item(0);
  if (!first) return null;
  const second = touches.item(1);
  if (!second) return { center: { x: first.clientX, y: first.clientY }, distance: 0 };
  return {
    center: { x: (first.clientX + second.clientX) / 2, y: (first.clientY + second.clientY) / 2 },
    distance: Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY),
  };
}

export function useMobileImageGestures(zoom: number, setZoom: (zoom: number) => void) {
  const gesture = useRef<Gesture | null>(null);
  const tap = useRef<{ point: Point; at: number } | null>(null);
  const currentZoom = useRef(zoom);
  currentZoom.current = zoom;

  const updateZoom = (element: HTMLDivElement, next: number, center: Point, previous: Point) => {
    const scale = next / currentZoom.current;
    const bounds = element.getBoundingClientRect();
    const x = element.scrollLeft + previous.x - bounds.left;
    const y = element.scrollTop + previous.y - bounds.top;
    currentZoom.current = next;
    setZoom(next);
    window.requestAnimationFrame(() => {
      element.scrollTo(x * scale - (center.x - bounds.left), y * scale - (center.y - bounds.top));
    });
  };

  const reset = () => {
    gesture.current = null;
    tap.current = null;
  };

  return {
    onTouchStart(event: TouchEvent<HTMLDivElement>) {
      const geometry = touchGeometry(event.touches);
      gesture.current = geometry && { ...geometry, moved: geometry.distance > 0 };
    },
    onTouchMove(event: TouchEvent<HTMLDivElement>) {
      const previous = gesture.current;
      const geometry = touchGeometry(event.touches);
      if (!previous || !geometry) return;
      const { center, distance } = geometry;
      const dx = previous.center.x - center.x;
      const dy = previous.center.y - center.y;
      const moved = previous.moved || distance > 0 || Math.hypot(dx, dy) > 6;
      gesture.current = { ...geometry, moved };
      const pane = event.currentTarget;
      if (distance > 0 && previous.distance > 0) {
        const next = Math.round(
          Math.max(100, Math.min(400, (currentZoom.current * distance) / previous.distance)),
        );
        updateZoom(pane, next, center, previous.center);
      } else if (!distance && currentZoom.current > 100) {
        pane.scrollLeft += dx;
        pane.scrollTop += dy;
      }
    },
    onTouchEnd(event: TouchEvent<HTMLDivElement>) {
      const hold = gesture.current;
      if (event.touches.length) {
        const geometry = touchGeometry(event.touches);
        gesture.current = geometry && { ...geometry, moved: true };
        return;
      }
      gesture.current = null;
      if (!hold || hold.moved) {
        tap.current = null;
        return;
      }
      const last = tap.current;
      if (
        last &&
        event.timeStamp - last.at < 300 &&
        Math.hypot(last.point.x - hold.center.x, last.point.y - hold.center.y) < 28
      ) {
        updateZoom(
          event.currentTarget,
          currentZoom.current > 100 ? 100 : 200,
          hold.center,
          hold.center,
        );
        tap.current = null;
      } else {
        tap.current = { point: hold.center, at: event.timeStamp };
      }
    },
    onTouchCancel: reset,
  };
}
