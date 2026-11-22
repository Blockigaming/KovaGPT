export function summarizeExcalidrawScene(source: string): string;
export function serializeExcalidrawDrawing(
  strokes: readonly {
    points: readonly (readonly [number, number])[];
    color: string;
    width: number;
  }[],
  background: string,
): string;
