declare module "gifenc" {
  type Format = "rgba4444";
  type Palette = number[][];
  const gifenc: {
    quantize(
      pixels: Uint8ClampedArray,
      maxColors: number,
      options: { format: Format; oneBitAlpha: boolean },
    ): Palette;
    applyPalette(pixels: Uint8ClampedArray, palette: Palette, format: Format): Uint8Array;
    GIFEncoder(): {
      writeFrame(
        pixels: Uint8Array,
        width: number,
        height: number,
        options: {
          palette: Palette;
          delay: number;
          transparent: boolean;
          transparentIndex: number;
          dispose: number;
        },
      ): void;
      finish(): void;
      bytes(): Uint8Array;
    };
  };
  export const GIFEncoder: typeof gifenc.GIFEncoder;
  export const quantize: typeof gifenc.quantize;
  export const applyPalette: typeof gifenc.applyPalette;
  export default gifenc;
}
