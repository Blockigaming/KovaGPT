export function createWorkViewLifetime(
  ownerId: string,
  onClear: () => void,
  target?: Pick<Window, "addEventListener" | "removeEventListener">,
): { controller: AbortController; dispose(): void };
