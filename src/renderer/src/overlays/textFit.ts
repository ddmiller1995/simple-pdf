import { layoutText, lineHeight, measureText, normalizeText } from '../pdf/textLayout';

/** Extra room (in em) so the caret and rounding never force an unwanted wrap. */
const SLACK_EM = 0.15;

export type TextSize = { width: number; height: number; lines: string[] };

/** Size (points) of `text` wrapped at `widthPt`. */
export function sizeAtWidth(text: string, fontSize: number, widthPt: number): TextSize {
  const lines = layoutText(text, fontSize, widthPt);
  return { width: widthPt, height: lines.length * lineHeight(fontSize), lines };
}

/**
 * Auto-grow: the box is as wide as the widest paragraph (never narrower than `minWidthPt`), up to
 * `maxWidthPt` (the room to the page edge), beyond which the text wraps.
 */
export function autoFit(
  text: string,
  fontSize: number,
  minWidthPt: number,
  maxWidthPt: number,
): TextSize {
  let widest = 0;
  for (const paragraph of normalizeText(text).split('\n')) {
    widest = Math.max(widest, measureText(paragraph, fontSize));
  }
  const wanted = Math.max(minWidthPt, widest + SLACK_EM * fontSize);
  return sizeAtWidth(text, fontSize, Math.max(Math.min(wanted, maxWidthPt), 1));
}
