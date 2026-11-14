import gifenc from "gifenc";

export type SpriteGrid = { columns: number; rows: number };
export type SpriteFrame = { x: number; y: number; width: number; height: number };

export function spriteFrames(width: number, height: number, { columns, rows }: SpriteGrid) {
  if (
    ![width, height, columns, rows].every(Number.isSafeInteger) ||
    width < columns ||
    height < rows ||
    width * height > 16_777_216 ||
    columns < 1 ||
    rows < 1 ||
    columns > 8 ||
    rows > 8 ||
    columns * rows > 32
  ) {
    throw new Error("Choose a grid with up to 32 frames and at most eight rows or columns.");
  }
  return Array.from({ length: columns * rows }, (_, index): SpriteFrame => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = Math.floor((column * width) / columns);
    const y = Math.floor((row * height) / rows);
    return {
      x,
      y,
      width: Math.floor(((column + 1) * width) / columns) - x,
      height: Math.floor(((row + 1) * height) / rows) - y,
    };
  });
}

export function createGifWriter(width: number, height: number, delay: number) {
  const gif = gifenc.GIFEncoder();
  return {
    write(pixels: Uint8ClampedArray) {
      const palette = gifenc.quantize(pixels, 128, { format: "rgba4444", oneBitAlpha: true });
      const transparentIndex = palette.findIndex((color) => color[3] === 0);
      gif.writeFrame(gifenc.applyPalette(pixels, palette, "rgba4444"), width, height, {
        palette,
        delay,
        transparent: transparentIndex >= 0,
        transparentIndex: Math.max(0, transparentIndex),
        dispose: transparentIndex >= 0 ? 2 : -1,
      });
    },
    finish() {
      gif.finish();
      return gif.bytes();
    },
  };
}
