import fontkit from '@pdf-lib/fontkit';
import type { PDFDocument } from '@cantoo/pdf-lib';

type Fontkit = Parameters<PDFDocument['registerFontkit']>[0];

/**
 * `@cantoo/pdf-lib` embeds font subsets by calling `subset.encode()` when it exists (the API of
 * newer fontkit versions). `@pdf-lib/fontkit` 1.1.1 also has a method of that name, but it needs
 * an output stream argument, so every `subset: true` embed fails with "Cannot read properties of
 * undefined (reading 'pos')". This wrapper hides `encode`, which makes pdf-lib use the stream API
 * that `@pdf-lib/fontkit` really supports. Without it we would have to embed the whole 600 KB font.
 */
export const pdfLibFontkit: Fontkit = {
  create(data: Uint8Array, postscriptName?: string) {
    const font = fontkit.create(data, postscriptName);
    const createSubset = font.createSubset.bind(font);
    font.createSubset = () => {
      const subset = createSubset();
      return {
        includeGlyph: (glyph: Parameters<typeof subset.includeGlyph>[0]) =>
          subset.includeGlyph(glyph),
        encodeStream: () => subset.encodeStream(),
        cff: (subset as unknown as { cff?: unknown }).cff,
      } as unknown as typeof subset;
    };
    return font;
  },
} as unknown as Fontkit;
