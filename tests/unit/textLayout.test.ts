import fontkit from '@pdf-lib/fontkit';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ASCENT_EM,
  DESCENT_EM,
  LINE_HEIGHT_FACTOR,
  baselineOffset,
  layoutText,
  lineHeight,
  measureText,
  textBlockHeight,
} from '@renderer/pdf/textLayout';
import { notoSansBytes, useNotoSans } from '../helpers/font';

beforeAll(useNotoSans);

describe('textLayout metrics', () => {
  it('hard-coded ascent/descent match the bundled Noto Sans (hhea and typo agree)', () => {
    const font = fontkit.create(notoSansBytes());
    expect(font.unitsPerEm).toBe(1000);
    expect(font.ascent / font.unitsPerEm).toBeCloseTo(ASCENT_EM, 9);
    expect(-font.descent / font.unitsPerEm).toBeCloseTo(DESCENT_EM, 9);
    expect(font.lineGap).toBe(0);
  });

  it('line height is 1.2 x font size', () => {
    expect(LINE_HEIGHT_FACTOR).toBe(1.2);
    expect(lineHeight(10)).toBeCloseTo(12, 9);
    expect(textBlockHeight(3, 10)).toBeCloseTo(36, 9);
    expect(textBlockHeight(0, 10)).toBeCloseTo(12, 9);
  });

  it('baseline offset equals CSS half-leading + ascent', () => {
    // (1.2 - 1.362) / 2 + 1.069 = 0.988 em
    expect(baselineOffset(100)).toBeCloseTo(98.8, 6);
    expect(baselineOffset(12)).toBeCloseTo(11.856, 6);
  });

  it('measures with plain glyph advances and scales linearly', () => {
    const w10 = measureText('Hello world', 10);
    expect(w10).toBeGreaterThan(40);
    expect(w10).toBeLessThan(80);
    expect(measureText('Hello world', 20)).toBeCloseTo(w10 * 2, 9);
    expect(measureText('', 12)).toBe(0);
    // No kerning: "AV" is the sum of its two glyph advances (0.639 + 0.600 em at size 100).
    expect(measureText('AV', 100)).toBeCloseTo(63.9 + 60, 6);
    // No ligature: "fi" is two glyphs.
    expect(measureText('fi', 100)).toBeCloseTo(measureText('f', 100) + measureText('i', 100), 6);
  });
});

describe('layoutText', () => {
  const size = 12;

  it('keeps short text on one line and never returns an empty array', () => {
    expect(layoutText('Hello', size, 500)).toEqual(['Hello']);
    expect(layoutText('', size, 500)).toEqual(['']);
  });

  it('honours hard newlines, including blank lines, CRLF and tabs', () => {
    expect(layoutText('a\nb', size, 500)).toEqual(['a', 'b']);
    expect(layoutText('a\n\nb', size, 500)).toEqual(['a', '', 'b']);
    expect(layoutText('a\r\nb', size, 500)).toEqual(['a', 'b']);
    expect(layoutText('a\tb', size, 500)).toEqual(['a    b']);
    expect(layoutText('a\n', size, 500)).toEqual(['a', '']);
  });

  it('wraps at spaces so every line fits, and loses no characters', () => {
    const text = 'The quick brown fox jumps over the lazy dog and keeps running far away';
    const max = 120;
    const lines = layoutText(text, size, max);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) expect(measureText(line.trimEnd(), size)).toBeLessThanOrEqual(max);
    expect(lines.join('')).toBe(text);
    // Greedy: the first word of the next line would not have fit on the previous one.
    for (let i = 0; i < lines.length - 1; i++) {
      const nextWord = lines[i + 1]!.split(' ')[0]!;
      expect(measureText(lines[i]! + nextWord, size)).toBeGreaterThan(max);
    }
  });

  it('lets trailing spaces hang instead of wrapping early', () => {
    const w = measureText('abc', size);
    // The box fits "abc" exactly; the following spaces must not push it to a new line.
    expect(layoutText('abc   def', size, w)).toEqual(['abc   ', 'def']);
    expect(layoutText('abc   ', size, w)).toEqual(['abc   ']);
  });

  it('keeps leading spaces and consecutive spaces', () => {
    expect(layoutText('  a  b', size, 500)).toEqual(['  a  b']);
  });

  it('breaks an overlong word between characters', () => {
    const word = 'Supercalifragilisticexpialidocious';
    const max = 60;
    const lines = layoutText(word, size, max);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) expect(measureText(line, size)).toBeLessThanOrEqual(max);
    expect(lines.join('')).toBe(word);
  });

  it('puts an overlong word after other text on its own line(s)', () => {
    const lines = layoutText('hi Supercalifragilisticexpialidocious', size, 60);
    expect(lines[0]).toBe('hi ');
    expect(lines.join('')).toBe('hi Supercalifragilisticexpialidocious');
  });

  it('always places at least one character per line, even in a tiny box', () => {
    const lines = layoutText('abc', size, 1);
    expect(lines).toEqual(['a', 'b', 'c']);
  });

  it('breaks after a hyphen between letters', () => {
    const w = Math.max(measureText('well-', size), measureText('known', size)) + 1;
    expect(layoutText('well-known', size, w)).toEqual(['well-', 'known']);
    // Not before digits or around spaces.
    expect(layoutText('a-1', size, 1000)).toEqual(['a-1']);
  });

  it('handles Unicode (accents, Cyrillic) and combining marks as single units', () => {
    const text = 'Привет мир éüñ';
    const lines = layoutText(text, size, 500);
    expect(lines).toEqual([text]);
    const decomposed = 'éééé'; // four "é" as base + combining acute
    const wide = layoutText(decomposed, size, measureText('e', size) * 2.5);
    expect(wide.join('')).toBe(decomposed);
    for (const line of wide) expect(line.startsWith('́')).toBe(false);
  });

  it('is deterministic and independent of box width for text that fits', () => {
    expect(layoutText('Hello world', size, 1000)).toEqual(layoutText('Hello world', size, 5000));
  });
});
