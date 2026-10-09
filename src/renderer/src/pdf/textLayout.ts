import fontkit from '@pdf-lib/fontkit';
import type { Font } from '@pdf-lib/fontkit';
import { getFontBytes } from './fontSource';

// Single source of truth for text metrics, shared by the on-screen TextBox and the export.
//
// Conventions (T5's TextBox must match these to look identical to the saved file):
//  - Font: Noto Sans Regular (`FONT_FAMILY` / `FONT_URL` in fontSource.ts), no bold/italic.
//  - Line height: `LINE_HEIGHT_FACTOR × fontSize` (CSS `line-height: 1.2`, unitless).
//  - No padding: the rect's top-left is the top-left of the first line box. Line i's box spans
//    [top - i*lineHeight - lineHeight, top - i*lineHeight] and its baseline is
//    `baselineOffset(fontSize)` below the line box's top edge (exactly what CSS does: the
//    font's ascent+descent content area is centred inside the line box).
//  - Wrapping: greedy, like CSS `white-space: pre-wrap; overflow-wrap: break-word`. Break
//    opportunities are after spaces and after a hyphen between letters; spaces at the end of
//    a line hang (never force a wrap). Overlong words break between grapheme clusters.
//  - Glyph advances are the plain per-glyph advances (no kerning, no ligatures), because that
//    is what pdf-lib writes. On screen use `font-kerning: none; font-variant-ligatures: none`.

/** Line height as a multiple of font size. */
export const LINE_HEIGHT_FACTOR = 1.2;

/** Noto Sans vertical metrics in em (hhea == typo; units per em is 1000). Verified by tests. */
export const ASCENT_EM = 1.069;
export const DESCENT_EM = 0.293;

/** OpenType features used for BOTH measuring and drawing (ligatures off, see above). */
export const TEXT_FEATURES: Record<string, boolean> = { liga: false, clig: false };

export function lineHeight(fontSize: number): number {
  return LINE_HEIGHT_FACTOR * fontSize;
}

/**
 * Distance from the top edge of a line box down to its baseline. This is the "ascent" in the
 * plan's formula (baseline = top - ascent - i * lineHeight), including CSS half-leading.
 */
export function baselineOffset(fontSize: number): number {
  const content = (ASCENT_EM + DESCENT_EM) * fontSize;
  return (lineHeight(fontSize) - content) / 2 + ASCENT_EM * fontSize;
}

/** Height of `lineCount` lines (a box with no padding). */
export function textBlockHeight(lineCount: number, fontSize: number): number {
  return Math.max(lineCount, 1) * lineHeight(fontSize);
}

let layoutFont: Font | null = null;

/** Load the bundled font for measuring. Call (and await) once at startup, before layoutText. */
export async function initTextLayout(fontBytes?: Uint8Array): Promise<void> {
  if (layoutFont && !fontBytes) return;
  layoutFont = fontkit.create(fontBytes ?? (await getFontBytes()));
}

export function isTextLayoutReady(): boolean {
  return layoutFont !== null;
}

function requireFont(): Font {
  if (!layoutFont) throw new Error('Text layout is not initialised: await initTextLayout() first');
  return layoutFont;
}

/** Width in points of a single line of text (no wrapping, no newlines). */
export function measureText(text: string, fontSize: number): number {
  if (text === '') return 0;
  const font = requireFont();
  const run = font.layout(text, TEXT_FEATURES);
  let units = 0;
  for (const glyph of run.glyphs) units += glyph.advanceWidth;
  return (units * fontSize) / font.unitsPerEm;
}

/** Replace characters the layout does not model: CRLF -> LF, tab -> 4 spaces. */
export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
}

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

function graphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}

/** Split into pieces: non-space run (cut after a letter-hyphen-letter) + its trailing spaces. */
function segments(paragraph: string): { word: string; spaces: string }[] {
  const out: { word: string; spaces: string }[] = [];
  const re = /([^ ]*)( *)/gu;
  for (const m of paragraph.matchAll(re)) {
    const word = m[1] ?? '';
    const spaces = m[2] ?? '';
    if (word === '' && spaces === '') continue;
    // Split "well-known" into "well-" + "known" (CSS also breaks after a hyphen).
    const parts = word.split(/(?<=[\p{L}\p{N}]-)(?=\p{L})/u);
    parts.forEach((part, i) => {
      out.push({ word: part, spaces: i === parts.length - 1 ? spaces : '' });
    });
  }
  return out;
}

/**
 * Wrap `text` into visual lines for a box `maxWidthPt` wide. Hard newlines start new lines
 * (an empty line stays as ''). Never returns an empty array. Lines keep their hanging trailing
 * spaces, so `lines.join('')` equals the text with its newlines removed.
 */
export function layoutText(text: string, fontSize: number, maxWidthPt: number): string[] {
  requireFont();
  const lines: string[] = [];
  for (const paragraph of normalizeText(text).split('\n')) {
    wrapParagraph(paragraph, fontSize, maxWidthPt, lines);
  }
  return lines;
}

function wrapParagraph(paragraph: string, fontSize: number, maxWidth: number, out: string[]): void {
  const eps = 1e-9;
  let line = ''; // current line, including its hanging trailing spaces
  const hasInk = (): boolean => line.trim() !== '';
  const flush = (): void => {
    out.push(line);
    line = '';
  };

  for (const { word, spaces } of segments(paragraph)) {
    if (word !== '') {
      if (hasInk() && measureText(line + word, fontSize) > maxWidth + eps) flush();
      if (measureText(line + word, fontSize) <= maxWidth + eps) {
        line += word;
      } else {
        // A single word longer than the box: break between grapheme clusters.
        for (const g of graphemes(word)) {
          if (hasInk() && measureText(line + g, fontSize) > maxWidth + eps) flush();
          line += g;
        }
      }
    }
    line += spaces;
  }
  out.push(line);
}
