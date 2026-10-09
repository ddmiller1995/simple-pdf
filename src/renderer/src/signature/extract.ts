// T0 stub. T3 implements the pure photo -> transparent ink algorithm (plan §6 T3).

export type RgbaImage = { data: Uint8ClampedArray; width: number; height: number };

export type InkColor = 'black' | 'blue' | 'original';

export type ExtractOptions = {
  sensitivity: number; // -0.2 .. +0.2 offset applied to the Otsu threshold
  color: InkColor;
  removeLines: boolean;
};

export type ExtractResult = {
  imageData: RgbaImage;
  bbox: { x: number; y: number; width: number; height: number };
  threshold: number;
};

export const DEFAULT_EXTRACT_OPTIONS: ExtractOptions = {
  sensitivity: 0,
  color: 'black',
  removeLines: false,
};

export function extractInk(_input: RgbaImage, _options: ExtractOptions): ExtractResult {
  throw new Error('NotImplemented: extractInk');
}
