import { join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PageViewport } from 'pdfjs-dist';
import type { PdfRect } from '../../src/shared/types';

/**
 * Shared round-trip checker (plan §9): opens PDF bytes with PDF.js (Node legacy build) and
 * reports, per page, the text items with their position and ON-SCREEN orientation, the image
 * paints with their bounds, and the form fields still present. Used by T2, T4, T5, T6, T7.
 *
 * All "screen" values are CSS px at `scale` (default 1 = points) relative to the page's
 * top-left, i.e. what a user sees (after /Rotate and CropBox). "user" values are absolute PDF
 * user space (points, origin bottom-left of the unrotated page).
 */

export type Matrix = [number, number, number, number, number, number];
export type ScreenPoint = { x: number; y: number };

export type InspectedText = {
  str: string;
  /** Raw PDF.js text item transform (user space). */
  transform: Matrix;
  /** Baseline origin in user space. */
  user: { x: number; y: number };
  /** Baseline origin on screen. */
  screen: ScreenPoint;
  /** Rotation of the baseline on screen in degrees; 0 means upright, left-to-right. */
  angleDeg: number;
  /** True when the text is mirrored on screen (never expected). */
  mirrored: boolean;
  /** Glyph height on screen (font size in px for upright text). */
  sizePx: number;
  /** Advance width on screen along the baseline. */
  widthPx: number;
};

export type InspectedImage = {
  /** Current transformation matrix at paint time (unit square -> user space). */
  ctm: Matrix;
  /** Axis-aligned bounds in user space. */
  user: PdfRect;
  /** Axis-aligned bounds on screen (left/top are the top-left corner). */
  screen: { left: number; top: number; width: number; height: number };
  /** Where the image's own corners land on screen (to check orientation). */
  corners: { topLeft: ScreenPoint; topRight: ScreenPoint; bottomLeft: ScreenPoint };
  /** True when the image's top edge is at the top and its left edge at the left on screen. */
  upright: boolean;
};

export type InspectedField = {
  name: string;
  fieldType: string | undefined;
  value: unknown;
  rect: number[];
  /** Raw PDF.js annotation data for anything not covered above. */
  raw: Record<string, unknown>;
};

export type InspectedPage = {
  index: number;
  /** PDF.js /Rotate for the page. */
  rotation: number;
  /** CropBox ∩ MediaBox in user space [x1, y1, x2, y2]. */
  view: number[];
  /** Displayed size in px at `scale`. */
  width: number;
  height: number;
  /** Real PDF.js viewport at `scale` (use with coords.ts). */
  viewport: PageViewport;
  text: InspectedText[];
  images: InspectedImage[];
  /** Widget (form field) annotations remaining on the page. */
  fields: InspectedField[];
};

export type InspectedPdf = {
  numPages: number;
  pages: InspectedPage[];
  /** `getFieldObjects()` result: null when the document has no form fields at all. */
  fieldObjects: Record<string, unknown> | null;
  /** All text of all pages (items joined by spaces), handy for `toContain`. */
  allText: string;
};

export type InspectOptions = { scale?: number };

const STANDARD_FONTS = join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/');
const CMAPS = join(process.cwd(), 'node_modules/pdfjs-dist/cmaps/');

function mul(a: Matrix, b: Matrix): Matrix {
  // Same convention as PDF.js Util.transform(a, b): result = a * b (apply b first, then a).
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function apply(m: Matrix, x: number, y: number): ScreenPoint {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function boundsOf(points: ScreenPoint[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

const IMAGE_OPS = new Set<number>([
  pdfjs.OPS.paintImageXObject,
  pdfjs.OPS.paintInlineImageXObject,
  pdfjs.OPS.paintImageMaskXObject,
]);

async function inspectImages(
  page: pdfjs.PDFPageProxy,
  screenMatrix: Matrix,
): Promise<InspectedImage[]> {
  const list = await page.getOperatorList();
  const images: InspectedImage[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i]!;
    const args = list.argsArray[i] as unknown;
    if (fn === pdfjs.OPS.save) {
      stack.push(ctm);
    } else if (fn === pdfjs.OPS.restore) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === pdfjs.OPS.transform) {
      ctm = mul(ctm, args as Matrix);
    } else if (fn === pdfjs.OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      const m = (args as unknown[])[0];
      if (Array.isArray(m)) ctm = mul(ctm, m as Matrix);
    } else if (fn === pdfjs.OPS.paintFormXObjectEnd) {
      ctm = stack.pop() ?? ctm;
    } else if (IMAGE_OPS.has(fn)) {
      images.push(describeImage(ctm, screenMatrix));
    }
  }
  return images;
}

function describeImage(ctm: Matrix, screenMatrix: Matrix): InspectedImage {
  // The image is the unit square [0,1]² mapped by ctm into user space; (0,1) is its top-left.
  const userCorners = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 0, 1), apply(ctm, 1, 1)];
  const u = boundsOf(userCorners);
  const toScreen = mul(screenMatrix, ctm);
  const bl = apply(toScreen, 0, 0);
  const br = apply(toScreen, 1, 0);
  const tl = apply(toScreen, 0, 1);
  const tr = apply(toScreen, 1, 1);
  const s = boundsOf([bl, br, tl, tr]);
  const eps = 1e-6;
  // Upright: top-left is the min-x/min-y corner, top-right shares its y, bottom-left its x.
  const upright =
    Math.abs(tl.x - s.minX) < eps &&
    Math.abs(tl.y - s.minY) < eps &&
    Math.abs(tr.y - tl.y) < eps &&
    Math.abs(bl.x - tl.x) < eps &&
    tr.x > tl.x &&
    bl.y > tl.y;
  return {
    ctm,
    user: { x: u.minX, y: u.minY, width: u.maxX - u.minX, height: u.maxY - u.minY },
    screen: { left: s.minX, top: s.minY, width: s.maxX - s.minX, height: s.maxY - s.minY },
    corners: { topLeft: tl, topRight: tr, bottomLeft: bl },
    upright,
  };
}

async function inspectText(
  page: pdfjs.PDFPageProxy,
  screenMatrix: Matrix,
): Promise<InspectedText[]> {
  const content = await page.getTextContent();
  const out: InspectedText[] = [];
  for (const item of content.items) {
    if (!('str' in item) || item.str === '') continue;
    const t = item.transform as Matrix;
    const m = mul(screenMatrix, t);
    out.push({
      str: item.str,
      transform: t,
      user: { x: t[4], y: t[5] },
      screen: { x: m[4], y: m[5] },
      angleDeg: (Math.atan2(m[1], m[0]) * 180) / Math.PI,
      mirrored: m[0] * m[3] - m[1] * m[2] > 0, // screen y points down, so normal text is < 0
      sizePx: Math.hypot(m[2], m[3]),
      widthPx: item.width * Math.hypot(screenMatrix[0], screenMatrix[1]),
    });
  }
  return out;
}

/** Open `bytes` (copied, so the caller's array stays usable) and describe every page. */
export async function inspectPdf(
  bytes: Uint8Array,
  options: InspectOptions = {},
): Promise<InspectedPdf> {
  const scale = options.scale ?? 1;
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    standardFontDataUrl: STANDARD_FONTS,
    cMapUrl: CMAPS,
    cMapPacked: true,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  const doc = await task.promise;
  try {
    const pages: InspectedPage[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      const viewport = page.getViewport({ scale });
      const screenMatrix = viewport.transform as Matrix;
      const annotations = (await page.getAnnotations()) as Record<string, unknown>[];
      pages.push({
        index: i,
        rotation: page.rotate,
        view: page.view,
        width: viewport.width,
        height: viewport.height,
        viewport,
        text: await inspectText(page, screenMatrix),
        images: await inspectImages(page, screenMatrix),
        fields: annotations
          .filter((a) => a.subtype === 'Widget')
          .map((a) => ({
            name: String(a.fieldName ?? ''),
            fieldType: a.fieldType as string | undefined,
            value: a.fieldValue,
            rect: a.rect as number[],
            raw: a,
          })),
      });
      page.cleanup();
    }
    const fieldObjects = (await doc.getFieldObjects()) as Record<string, unknown> | null;
    return {
      numPages: doc.numPages,
      pages,
      fieldObjects,
      allText: pages.map((p) => p.text.map((t) => t.str).join(' ')).join('\n'),
    };
  } finally {
    await task.destroy();
  }
}

/** First text item whose string equals / contains `needle` on a page (throws if absent). */
export function findText(page: InspectedPage, needle: string): InspectedText {
  const hit =
    page.text.find((t) => t.str === needle) ?? page.text.find((t) => t.str.includes(needle));
  if (!hit) {
    throw new Error(
      `Text "${needle}" not found on page ${page.index}; have: ${JSON.stringify(page.text.map((t) => t.str))}`,
    );
  }
  return hit;
}
