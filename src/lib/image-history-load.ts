import type { ImageHistoryItem } from "./image-history";

export type ImageHistorySnapshot = {
  items: ImageHistoryItem[];
  storageVerified: boolean;
};

/** A clear or principal change must invalidate reads already waiting on IndexedDB. */
export function createImageHistoryLoadGuard() {
  let generation = 0;
  return {
    invalidate() {
      generation += 1;
    },
    async load(
      read: () => Promise<ImageHistorySnapshot>,
      accept: (snapshot: ImageHistorySnapshot) => void,
    ) {
      const started = ++generation;
      const snapshot = await read();
      if (started !== generation) {
        for (const item of snapshot.items) {
          if (item.objectUrl) URL.revokeObjectURL(item.imageUrl);
        }
        return;
      }
      accept(snapshot);
    },
  };
}
