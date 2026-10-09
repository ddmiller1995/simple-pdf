import { useMemo } from 'react';
import type { TextOverlay } from '@shared/types';
import { FONT_FAMILY } from '../pdf/fontSource';
import { LINE_HEIGHT_FACTOR, layoutText } from '../pdf/textLayout';

export const rgbCss = (c: [number, number, number]): string =>
  `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;

/** Typography shared by the static box and the editing textarea (must match pdf/textLayout.ts). */
export function textStyle(overlay: TextOverlay, scale: number): React.CSSProperties {
  return {
    fontFamily: `"${FONT_FAMILY}", sans-serif`,
    fontSize: overlay.fontSize * scale,
    lineHeight: LINE_HEIGHT_FACTOR,
    fontKerning: 'none',
    fontVariantLigatures: 'none',
    padding: 0,
    margin: 0,
    color: rgbCss(overlay.color),
  };
}

/**
 * Static text content, filling its positioned parent. Lines come from the same `layoutText` the
 * export uses, so what is on screen is what gets saved. `widthPt` is the box's VISUAL width
 * (for rotated pages this is not `rect.width`).
 */
export function TextBox({
  overlay,
  widthPt,
  scale,
}: {
  overlay: TextOverlay;
  widthPt: number;
  scale: number;
}) {
  const lines = useMemo(
    () => layoutText(overlay.text, overlay.fontSize, widthPt),
    [overlay.text, overlay.fontSize, widthPt],
  );
  const lineHeightPx = overlay.fontSize * LINE_HEIGHT_FACTOR * scale;
  return (
    <div className="text-box" style={textStyle(overlay, scale)} data-testid="text-content">
      {lines.map((line, i) => (
        <div key={i} className="text-line" style={{ height: lineHeightPx }}>
          {line}
        </div>
      ))}
    </div>
  );
}
