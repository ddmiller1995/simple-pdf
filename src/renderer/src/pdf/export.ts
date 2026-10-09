import { PDFDocument, degrees, rgb } from '@cantoo/pdf-lib';
import type { PDFImage, PDFPage } from '@cantoo/pdf-lib';
import { pdfLibFontkit } from './fontkitCompat';
import type { FormValues, ImageOverlay, Overlay, PageInfo, TextOverlay } from '@shared/types';
import {
  normalizeRotation,
  userRectToVisualRect,
  visualPointToUser,
  type PageBox,
  type VisualRect,
} from './coords';
import { getFontBytes } from './fontSource';
import { applyFormValues } from './forms';
import {
  TEXT_FEATURES,
  baselineOffset,
  initTextLayout,
  layoutText,
  lineHeight,
} from './textLayout';

export type ExportInput = {
  sourceBytes: Uint8Array;
  overlays: Overlay[];
  formValues: FormValues;
  pages: PageInfo[];
};

/**
 * Build the output PDF: form values are applied (and flattened) first by `applyFormValues`,
 * then every overlay is drawn into its page, rotated so it appears exactly as it did on screen.
 * `sourceBytes` is never mutated. Page geometry is read from the file itself (pdf-lib), so the
 * `pages` list is only informational.
 */
export async function exportPdf(input: ExportInput): Promise<Uint8Array> {
  const { sourceBytes, overlays, formValues } = input;
  const doc = await PDFDocument.load(sourceBytes, { updateMetadata: false });

  applyFormValues(doc, formValues);

  const pdfPages = doc.getPages();
  const textOverlays = overlays.filter(
    (o): o is TextOverlay => o.kind === 'text' && o.text.trim() !== '' && inRange(o, pdfPages),
  );
  const imageOverlays = overlays.filter(
    (o): o is ImageOverlay => o.kind === 'image' && inRange(o, pdfPages),
  );

  if (textOverlays.length > 0) {
    doc.registerFontkit(pdfLibFontkit);
    const fontBytes = await getFontBytes();
    await initTextLayout(); // measuring uses the very same (cached) font bytes
    const font = await doc.embedFont(fontBytes, { subset: true, features: TEXT_FEATURES });
    for (const o of textOverlays) drawText(pdfPages[o.pageIndex]!, o, font);
  }

  const images = new Map<string, Promise<PDFImage>>();
  for (const o of imageOverlays) {
    let image = images.get(o.signatureId);
    if (!image) {
      image = doc.embedPng(dataUrlToBytes(o.pngDataUrl));
      images.set(o.signatureId, image);
    }
    drawImage(pdfPages[o.pageIndex]!, o, await image);
  }

  // Fields applyFormValues could not flatten (e.g. non-WinAnsi text) carry NeedAppearances so
  // viewers draw them; don't let pdf-lib regenerate their appearances with a WinAnsi font.
  return doc.save({ updateFieldAppearances: false });
}

function inRange(o: Overlay, pages: PDFPage[]): boolean {
  return Number.isInteger(o.pageIndex) && o.pageIndex >= 0 && o.pageIndex < pages.length;
}

/** Visible area of the page (CropBox ∩ MediaBox, like PDF.js's `view`) plus /Rotate. */
function pageBox(page: PDFPage): PageBox {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const x1 = Math.max(media.x, crop.x);
  const y1 = Math.max(media.y, crop.y);
  const x2 = Math.min(media.x + media.width, crop.x + crop.width);
  const y2 = Math.min(media.y + media.height, crop.y + crop.height);
  const useCrop = x2 > x1 && y2 > y1;
  return {
    x: useCrop ? x1 : media.x,
    y: useCrop ? y1 : media.y,
    width: useCrop ? x2 - x1 : media.width,
    height: useCrop ? y2 - y1 : media.height,
    rotation: normalizeRotation(page.getRotation().angle),
  };
}

type Font = Awaited<ReturnType<PDFDocument['embedFont']>>;

function drawText(page: PDFPage, o: TextOverlay, font: Font): void {
  const box = pageBox(page);
  const visual: VisualRect = userRectToVisualRect(box, o.rect);
  const lines = layoutText(o.text, o.fontSize, visual.width);
  const top = visual.bottom + visual.height;
  const lh = lineHeight(o.fontSize);
  const ascent = baselineOffset(o.fontSize);
  const [r, g, b] = o.color.map((c) => Math.min(1, Math.max(0, c)));
  const color = rgb(r ?? 0, g ?? 0, b ?? 0);

  lines.forEach((line, i) => {
    if (line.trim() === '') return;
    const origin = visualPointToUser(box, visual.left, top - ascent - i * lh);
    page.drawText(line, {
      x: origin.x,
      y: origin.y,
      size: o.fontSize,
      font,
      color,
      rotate: degrees(box.rotation),
    });
  });
}

function drawImage(page: PDFPage, o: ImageOverlay, image: PDFImage): void {
  const box = pageBox(page);
  const visual = userRectToVisualRect(box, o.rect);
  // pdf-lib rotates about the image's bottom-left corner, so anchor it at the visual
  // bottom-left corner mapped back into user space.
  const origin = visualPointToUser(box, visual.left, visual.bottom);
  page.drawImage(image, {
    x: origin.x,
    y: origin.y,
    width: visual.width,
    height: visual.height,
    rotate: degrees(box.rotation),
  });
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const m = /^data:image\/png;base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('Signature image is not a PNG data URL');
  const binary = atob(m[1]!);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
