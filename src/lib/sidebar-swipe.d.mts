export function isClearSidebarSwipe(args: {
  open: boolean;
  dx: number;
  dy: number;
  elapsedMs: number;
}): boolean;

export function shouldSettleSidebarSwipe(args: {
  open: boolean;
  dx: number;
  dy: number;
  width: number;
  elapsedMs: number;
}): boolean;

export function installInteractiveSidebarSwipe(args: {
  open: boolean;
  target: EventTarget;
  drawer: HTMLElement;
  scrim: HTMLElement;
  isMobile: () => boolean;
  canStart: (event: TouchEvent) => boolean;
  canContinue: (event: TouchEvent) => boolean;
  toggle: () => void;
}): () => void;
