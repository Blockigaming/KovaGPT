import type { ImageHistoryItem } from "./image-history";

/** A clear or principal change must invalidate reads already waiting on IndexedDB. */
export function createImageHistoryLoadGuard() {
  let generation = 0;
  return {
    invalidate() {
      generation += 1;
    },
    async load(
      read: () => Promise<ImageHistoryItem[]>,
      accept: (items: ImageHistoryItem[]) => void,
    ) {
      const started = ++generation;
      const items = await read();
      if (started !== generation) {
        for (const item of items) {
          if (item.objectUrl) URL.revokeObjectURL(item.imageUrl);
        }
        return;
      }
      accept(items);
    },
  };
}
