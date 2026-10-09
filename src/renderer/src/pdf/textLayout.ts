// T0 stub. T2 implements the single source of truth for text metrics (screen + export).

/** Line height as a multiple of font size. */
export const LINE_HEIGHT_FACTOR = 1.2;

export function layoutText(_text: string, _fontSize: number, _maxWidthPt: number): string[] {
  throw new Error('NotImplemented: layoutText');
}
