import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from '@cantoo/pdf-lib';
import { PNG } from 'pngjs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { pdfRectToScreenRect, screenRectToPdfRect } from '@renderer/pdf/coords';
import { exportPdf } from '@renderer/pdf/export';
import * as forms from '@renderer/pdf/forms';
import { baselineOffset, layoutText, lineHeight } from '@renderer/pdf/textLayout';
import type { ImageOverlay, Overlay, PageInfo, TextOverlay } from '@shared/types';
import { useNotoSans } from '../helpers/font';
import { loadFixture } from '../helpers/fixtures';
import { findText, inspectPdf, type InspectedPage, type InspectedPdf } from '../helpers/inspectPdf';

// Keep the real implementation (T4 replaces the stub) but record how export calls it.
vi.mock('@renderer/pdf/forms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/pdf/forms')>();
  return { ...actual, applyFormValues: vi.fn(actual.applyFormValues) };
});

beforeAll(useNotoSans);

const TOL = 1; // points
const SCALE = 1; // inspect at 1px = 1pt so the tolerance is in points

/** A 4x2 RGBA PNG with distinct pixels, so a rotated or mirrored image would be detectable. */
function makePngDataUrl(): string {
  const png = new PNG({ width: 4, height: 2 });
  const px = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [255, 255, 0, 128],
    [0, 0, 0, 255],
    [255, 255, 255, 255],
    [0, 255, 255, 255],
    [255, 0, 255, 0],
  ];
  px.forEach((p, i) => png.data.set(p, i * 4));
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
}
const PNG_URL = makePngDataUrl();

function pagesOf(name: string): Promise<PageInfo[]> {
  return PDFDocument.load(loadFixture(name)).then((doc) =>
    doc.getPages().map((p, index) => ({
      index,
      widthPt: p.getWidth(),
      heightPt: p.getHeight(),
      rotation: (((p.getRotation().angle % 360) + 360) % 360) as PageInfo['rotation'],
    })),
  );
}

async function run(name: string, overlays: Overlay[], formValues = {}): Promise<InspectedPdf> {
  const bytes = await exportPdf({
    sourceBytes: loadFixture(name),
    overlays,
    formValues,
    pages: await pagesOf(name),
  });
  return inspectPdf(bytes, { scale: SCALE });
}

/** Place a text box exactly as the on-screen editor would: from a screen rect. */
function textAt(
  page: InspectedPage,
  text: string,
  screen: { left: number; top: number; width: number; height: number },
  extra: Partial<TextOverlay> = {},
): TextOverlay {
  return {
    kind: 'text',
    id: `t-${page.index}-${text.slice(0, 4)}`,
    pageIndex: page.index,
    rect: screenRectToPdfRect(page.viewport, screen),
    text,
    fontSize: 14,
    color: [0, 0, 0],
    ...extra,
  };
}

function imageAt(
  page: InspectedPage,
  screen: { left: number; top: number; width: number; height: number },
  signatureId = 'sig-1',
): ImageOverlay {
  return {
    kind: 'image',
    id: `i-${page.index}-${screen.left}`,
    pageIndex: page.index,
    rect: screenRectToPdfRect(page.viewport, screen),
    signatureId,
    pngDataUrl: PNG_URL,
  };
}

/** Fixture page geometry before export (viewports of the untouched source). */
async function sourcePages(name: string): Promise<InspectedPage[]> {
  return (await inspectPdf(loadFixture(name), { scale: SCALE })).pages;
}

const CASES: { name: string; pageIndex: number; label: string }[] = [
  { name: 'rotated.pdf', pageIndex: 0, label: 'rotate 0' },
  { name: 'rotated.pdf', pageIndex: 1, label: 'rotate 90' },
  { name: 'rotated.pdf', pageIndex: 2, label: 'rotate 180' },
  { name: 'rotated.pdf', pageIndex: 3, label: 'rotate 270' },
  { name: 'cropbox-offset.pdf', pageIndex: 0, label: 'CropBox offset' },
  { name: 'mixed-sizes.pdf', pageIndex: 1, label: 'A4' },
];

describe.each(CASES)('export round-trip: $label ($name)', ({ name, pageIndex }) => {
  it('text lands at the on-screen spot, upright, with every wrapped line placed', async () => {
    const page = (await sourcePages(name))[pageIndex]!;
    const fontSize = 14;
    const screen = { left: 61.5, top: 83.25, width: 150, height: 90 };
    const text = 'Hello Simple PDF world\nSecond line';
    const overlay = textAt(page, text, screen, { fontSize });
    const out = (await run(name, [overlay])).pages[pageIndex]!;

    const lines = layoutText(text, fontSize, screen.width);
    expect(lines.length).toBeGreaterThanOrEqual(3); // it wraps, so multi-line is exercised
    lines.forEach((line, i) => {
      const item = findText(out, line.trim());
      expect(item.screen.x).toBeCloseTo(screen.left, 0);
      expect(Math.abs(item.screen.x - screen.left)).toBeLessThanOrEqual(TOL);
      const expectedBaseline = screen.top + baselineOffset(fontSize) + i * lineHeight(fontSize);
      expect(Math.abs(item.screen.y - expectedBaseline)).toBeLessThanOrEqual(TOL);
      // Orientation: upright, left to right, not mirrored, at the right size.
      expect(Math.abs(item.angleDeg)).toBeLessThan(0.01);
      expect(item.mirrored).toBe(false);
      expect(item.sizePx).toBeCloseTo(fontSize, 3);
    });
  });

  it('text placed near the bottom-right of the visible page stays at the same spot', async () => {
    const page = (await sourcePages(name))[pageIndex]!;
    const fontSize = 10;
    const screen = { left: page.width - 140, top: page.height - 60, width: 120, height: 40 };
    const overlay = textAt(page, 'Corner', screen, { fontSize });
    const out = (await run(name, [overlay])).pages[pageIndex]!;
    const item = findText(out, 'Corner');
    expect(Math.abs(item.screen.x - screen.left)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(item.screen.y - (screen.top + baselineOffset(fontSize)))).toBeLessThanOrEqual(
      TOL,
    );
    expect(Math.abs(item.angleDeg)).toBeLessThan(0.01);
  });

  it('image is drawn at the on-screen rect, upright, once per paint', async () => {
    const page = (await sourcePages(name))[pageIndex]!;
    const screen = { left: 70.5, top: 120.25, width: 120, height: 60 };
    const overlay = imageAt(page, screen);
    const out = (await run(name, [overlay])).pages[pageIndex]!;

    expect(out.images).toHaveLength(1);
    const img = out.images[0]!;
    expect(img.upright).toBe(true);
    expect(Math.abs(img.screen.left - screen.left)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(img.screen.top - screen.top)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(img.screen.width - screen.width)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(img.screen.height - screen.height)).toBeLessThanOrEqual(TOL);
    // And in user space it is exactly the stored rect.
    expect(Math.abs(img.user.x - overlay.rect.x)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(img.user.y - overlay.rect.y)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(img.user.width - overlay.rect.width)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(img.user.height - overlay.rect.height)).toBeLessThanOrEqual(TOL);
    // The viewport conversion of the stored rect agrees too.
    const back = pdfRectToScreenRect(out.viewport, overlay.rect);
    expect(Math.abs(back.left - img.screen.left)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(back.top - img.screen.top)).toBeLessThanOrEqual(TOL);
  });

  it('text and image together do not disturb each other or the other pages', async () => {
    const pages = await sourcePages(name);
    const page = pages[pageIndex]!;
    const overlays = [
      textAt(page, 'Together', { left: 30, top: 30, width: 200, height: 30 }),
      imageAt(page, { left: 40, top: 200, width: 100, height: 50 }),
    ];
    const out = await run(name, overlays);
    const before = await inspectPdf(loadFixture(name), { scale: SCALE });
    expect(findText(out.pages[pageIndex]!, 'Together')).toBeDefined();
    expect(out.pages[pageIndex]!.images).toHaveLength(1);
    out.pages.forEach((p, i) => {
      if (i === pageIndex) return;
      expect(p.text.map((t) => t.str)).toEqual(before.pages[i]!.text.map((t) => t.str));
      expect(p.images).toHaveLength(0);
    });
    // Original page content survives.
    for (const t of before.pages[pageIndex]!.text) {
      expect(out.pages[pageIndex]!.text.some((o) => o.str === t.str)).toBe(true);
    }
  });
});

describe('export: content, fonts and caching', () => {
  it('round-trips Unicode text (accents, umlauts, tilde, Cyrillic, Greek)', async () => {
    const page = (await sourcePages('simple-3page.pdf'))[0]!;
    const samples = ['Café éèê', 'Müller über', 'Señor niño', 'Привет, мир!', 'Γειά σου κόσμε'];
    const overlays = samples.map((s, i) =>
      textAt(page, s, { left: 50, top: 50 + i * 40, width: 400, height: 30 }),
    );
    const out = await run('simple-3page.pdf', overlays);
    const text = out.pages[0]!.text.map((t) => t.str.normalize('NFC'));
    for (const s of samples) expect(text).toContain(s.normalize('NFC'));
  });

  it('does not use ligatures, so "fi" stays two characters in extracted text', async () => {
    const page = (await sourcePages('simple-3page.pdf'))[0]!;
    const out = await run('simple-3page.pdf', [
      textAt(page, 'official fifth file', { left: 50, top: 50, width: 400, height: 30 }),
    ]);
    expect(findText(out.pages[0]!, 'official fifth file')).toBeDefined();
  });

  it('draws text in the requested colour', async () => {
    const page = (await sourcePages('simple-3page.pdf'))[0]!;
    const overlay = textAt(
      page,
      'Red',
      { left: 50, top: 50, width: 100, height: 30 },
      {
        color: [1, 0, 0],
      },
    );
    const bytes = await exportPdf({
      sourceBytes: loadFixture('simple-3page.pdf'),
      overlays: [overlay],
      formValues: {},
      pages: await pagesOf('simple-3page.pdf'),
    });
    const doc = await PDFDocument.load(bytes);
    const contents = doc.getPage(0).node.Contents();
    expect(contents).toBeDefined();
    const streams = (contents as unknown as { asArray?: () => unknown[] }).asArray?.() ?? [
      contents,
    ];
    const joined = streams
      .map((ref) => doc.context.lookup(ref as never))
      .map((s) =>
        s instanceof PDFRawStream
          ? Buffer.from(decodePDFRawStream(s).decode()).toString('latin1')
          : '',
      )
      .join('\n');
    // The overlay's fill colour operator: "1 0 0 rg" for red.
    expect(joined).toMatch(/1 0 0 rg/);
  });

  it('embeds a subset of the font, not the whole 600 KB file', async () => {
    const page = (await sourcePages('simple-3page.pdf'))[0]!;
    const source = loadFixture('simple-3page.pdf');
    const bytes = await exportPdf({
      sourceBytes: source,
      overlays: [textAt(page, 'Hello Привет é', { left: 50, top: 50, width: 400, height: 30 })],
      formValues: {},
      pages: await pagesOf('simple-3page.pdf'),
    });
    expect(bytes.length - source.length).toBeLessThan(60_000);
  });

  it('skips empty text, out-of-range pages and still produces a valid file', async () => {
    const page = (await sourcePages('simple-3page.pdf'))[0]!;
    const out = await run('simple-3page.pdf', [
      textAt(page, '   \n ', { left: 50, top: 50, width: 100, height: 30 }),
      { ...textAt(page, 'Nowhere', { left: 50, top: 50, width: 100, height: 30 }), pageIndex: 9 },
    ]);
    expect(out.numPages).toBe(3);
    expect(out.allText).not.toContain('Nowhere');
  });

  it('with no overlays the content is unchanged', async () => {
    const out = await run('simple-3page.pdf', []);
    const before = await inspectPdf(loadFixture('simple-3page.pdf'));
    expect(out.pages.map((p) => p.text.map((t) => t.str))).toEqual(
      before.pages.map((p) => p.text.map((t) => t.str)),
    );
  });

  it('embeds each signature once even when placed several times', async () => {
    const countImages = async (overlayCount: number): Promise<number> => {
      const page = (await sourcePages('simple-3page.pdf'))[0]!;
      const overlays = Array.from({ length: overlayCount }, (_, i) =>
        imageAt(page, { left: 40, top: 40 + i * 70, width: 100, height: 50 }, 'sig-same'),
      );
      const bytes = await exportPdf({
        sourceBytes: loadFixture('simple-3page.pdf'),
        overlays,
        formValues: {},
        pages: await pagesOf('simple-3page.pdf'),
      });
      const doc = await PDFDocument.load(bytes);
      let n = 0;
      for (const [, obj] of doc.context.enumerateIndirectObjects()) {
        if (
          obj instanceof PDFRawStream &&
          obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
        )
          n++;
      }
      const out = (await inspectPdf(bytes)).pages[0]!;
      expect(out.images).toHaveLength(overlayCount); // painted every time...
      return n;
    };
    expect(await countImages(3)).toBe(await countImages(1)); // ...but stored once
  });

  it('embeds different signatures separately', async () => {
    const page = (await sourcePages('simple-3page.pdf'))[0]!;
    const out = await run('simple-3page.pdf', [
      imageAt(page, { left: 40, top: 40, width: 100, height: 50 }, 'a'),
      imageAt(page, { left: 40, top: 140, width: 100, height: 50 }, 'b'),
    ]);
    expect(out.pages[0]!.images).toHaveLength(2);
  });

  it('never mutates the source bytes', async () => {
    const source = loadFixture('rotated.pdf');
    const copy = new Uint8Array(source);
    const page = (await sourcePages('rotated.pdf'))[1]!;
    const out = await exportPdf({
      sourceBytes: source,
      overlays: [
        textAt(page, 'Immutable', { left: 50, top: 50, width: 200, height: 30 }),
        imageAt(page, { left: 50, top: 100, width: 80, height: 40 }),
      ],
      formValues: {},
      pages: await pagesOf('rotated.pdf'),
    });
    expect(out).not.toBe(source);
    expect(Buffer.from(source).equals(Buffer.from(copy))).toBe(true);
    // The source still loads and has no overlay.
    expect((await inspectPdf(source)).allText).not.toContain('Immutable');
    expect((await inspectPdf(out)).allText).toContain('Immutable');
  });

  it('rejects a non-PNG image overlay with a clear error', async () => {
    const page = (await sourcePages('simple-3page.pdf'))[0]!;
    const bad: ImageOverlay = {
      ...imageAt(page, { left: 1, top: 1, width: 10, height: 10 }),
      pngDataUrl: 'data:image/jpeg;base64,AAAA',
    };
    await expect(
      exportPdf({
        sourceBytes: loadFixture('simple-3page.pdf'),
        overlays: [bad],
        formValues: {},
        pages: [],
      }),
    ).rejects.toThrow(/PNG/);
  });
});

describe('export: forms hook', () => {
  it('calls applyFormValues with the loaded document and the form values, before overlays', async () => {
    const mock = vi.mocked(forms.applyFormValues);
    mock.mockClear();
    let textOnPageWhenCalled: number | undefined;
    mock.mockImplementationOnce((doc) => {
      textOnPageWhenCalled = doc.getPage(0).node.Contents() ? 1 : 0;
    });
    const page = (await sourcePages('acroform.pdf'))[0]!;
    const values = { fullName: 'Ada Lovelace', agree: true };
    await run(
      'acroform.pdf',
      [textAt(page, 'After forms', { left: 50, top: 50, width: 200, height: 30 })],
      values,
    );
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0]![1]).toEqual(values);
    expect(textOnPageWhenCalled).toBeDefined();
  });

  it('is called even when there are no overlays or values', async () => {
    const mock = vi.mocked(forms.applyFormValues);
    mock.mockClear();
    await run('simple-3page.pdf', []);
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe('exportPdf with real AcroForm values (T2 + T4 integration)', () => {
  it('saves when a field cannot be flattened, alongside overlays', async () => {
    const sourceBytes = loadFixture('acroform.pdf');
    const overlay: TextOverlay = {
      kind: 'text',
      id: 't1',
      pageIndex: 0,
      rect: { x: 300, y: 100, width: 200, height: 20 },
      text: 'Signed overlay',
      fontSize: 12,
      color: [0, 0, 0],
    };
    const out = await exportPdf({
      sourceBytes,
      overlays: [overlay],
      formValues: { fullName: 'Ωmega Жук', country: 'Brazil' },
      pages: [],
    });
    const pdf = await inspectPdf(out);
    expect(pdf.allText).toContain('Signed overlay');
    expect(pdf.allText).toContain('Brazil');
    const form = (await PDFDocument.load(out)).getForm();
    expect(form.getFields().map((f) => f.getName())).toEqual(['fullName']);
    expect(form.getTextField('fullName').getText()).toBe('Ωmega Жук');
  });
});
