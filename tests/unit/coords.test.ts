import { describe, expect, it } from 'vitest';
import {
  normalizeRotation,
  pdfPointToScreenPoint,
  pdfRectToScreenRect,
  screenPointToPdfPoint,
  screenRectToPdfRect,
  userPointToVisual,
  userRectToVisualRect,
  visualPointToUser,
  visualSize,
  type PageBox,
  type Rotation,
} from '@renderer/pdf/coords';
import type { PdfRect } from '@shared/types';
import { loadFixture } from '../helpers/fixtures';
import { inspectPdf, type InspectedPage } from '../helpers/inspectPdf';

const SCALES = [1, 1.5, 2.25];

function boxOf(page: InspectedPage): PageBox {
  const [x1, y1, x2, y2] = page.view as [number, number, number, number];
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1, rotation: page.rotation as Rotation };
}

type Box = { left: number; top: number; width: number; height: number };

function expectRectClose(actual: Box, expected: Box): void {
  expect(actual.left).toBeCloseTo(expected.left, 6);
  expect(actual.top).toBeCloseTo(expected.top, 6);
  expect(actual.width).toBeCloseTo(expected.width, 6);
  expect(actual.height).toBeCloseTo(expected.height, 6);
}

/** rotated.pdf marker: unrotated top-left corner, user rect (20, 722, 50x50) on Letter. */
const MARKER: PdfRect = { x: 20, y: 722, width: 50, height: 50 };

describe('coords: screen <-> PDF rects with real PDF.js viewports', () => {
  for (const scale of SCALES) {
    it(`rotated.pdf markers land where the fixture says (scale ${scale})`, async () => {
      const pdf = await inspectPdf(loadFixture('rotated.pdf'), { scale });
      // Letter 612x792. Visual size is 612x792 for 0/180 and 792x612 for 90/270.
      const expected: Record<number, { left: number; top: number }> = {
        0: { left: 20, top: 20 }, // top-left
        90: { left: 792 - 70, top: 20 }, // top-right
        180: { left: 612 - 70, top: 792 - 70 }, // bottom-right
        270: { left: 20, top: 612 - 70 }, // bottom-left
      };
      for (const page of pdf.pages) {
        const e = expected[page.rotation]!;
        const rect = pdfRectToScreenRect(page.viewport, MARKER);
        expectRectClose(rect, {
          left: e.left * scale,
          top: e.top * scale,
          width: 50 * scale,
          height: 50 * scale,
        });
      }
    });

    it(`round-trips screen -> PDF -> screen for every rotation (scale ${scale})`, async () => {
      const pdf = await inspectPdf(loadFixture('rotated.pdf'), { scale });
      const screen = {
        left: 123.5 * scale,
        top: 87.25 * scale,
        width: 140 * scale,
        height: 33 * scale,
      };
      for (const page of pdf.pages) {
        const pdfRect = screenRectToPdfRect(page.viewport, screen);
        // 90/270 swap the axes in user space.
        const swapped = page.rotation === 90 || page.rotation === 270;
        expect(pdfRect.width).toBeCloseTo(swapped ? 33 : 140, 6);
        expect(pdfRect.height).toBeCloseTo(swapped ? 140 : 33, 6);
        expectRectClose(pdfRectToScreenRect(page.viewport, pdfRect), screen);
      }
    });
  }

  it('handles the CropBox offset: the marker at the CropBox corner is at the screen corner', async () => {
    for (const scale of SCALES) {
      const [page] = (await inspectPdf(loadFixture('cropbox-offset.pdf'), { scale })).pages;
      expect(page!.view).toEqual([50, 100, 450, 600]);
      // Marker: user rect (50,100) 40x40 = bottom-left of the visible 400x500 area.
      const rect = pdfRectToScreenRect(page!.viewport, { x: 50, y: 100, width: 40, height: 40 });
      expectRectClose(rect, {
        left: 0,
        top: (500 - 40) * scale,
        width: 40 * scale,
        height: 40 * scale,
      });
      // And back: the top-left screen pixel is user point (50, 600).
      const back = screenRectToPdfRect(page!.viewport, {
        left: 0,
        top: 0,
        width: 10 * scale,
        height: 10 * scale,
      });
      expect(back.x).toBeCloseTo(50, 6);
      expect(back.y).toBeCloseTo(590, 6);
      expect(back.width).toBeCloseTo(10, 6);
      expect(back.height).toBeCloseTo(10, 6);
    }
  });

  it('point helpers agree with the rect helpers', async () => {
    const pdf = await inspectPdf(loadFixture('rotated.pdf'), { scale: 1.5 });
    for (const page of pdf.pages) {
      const p = screenPointToPdfPoint(page.viewport, 100, 200);
      const s = pdfPointToScreenPoint(page.viewport, p.x, p.y);
      expect(s.left).toBeCloseTo(100, 6);
      expect(s.top).toBeCloseTo(200, 6);
    }
  });
});

describe('coords: viewport-free visual frame (used by export) matches PDF.js', () => {
  const fixtures = ['rotated.pdf', 'cropbox-offset.pdf', 'mixed-sizes.pdf'];
  const rects: PdfRect[] = [
    { x: 100, y: 200, width: 150, height: 40 },
    { x: 20, y: 722, width: 50, height: 50 },
    { x: 55, y: 105, width: 10, height: 300 },
  ];
  for (const name of fixtures) {
    it(`${name}: userRectToVisualRect equals pdfRectToScreenRect (y flipped)`, async () => {
      const pdf = await inspectPdf(loadFixture(name), { scale: 1 });
      for (const page of pdf.pages) {
        const box = boxOf(page);
        const size = visualSize(box);
        expect(page.width).toBeCloseTo(size.width, 6);
        expect(page.height).toBeCloseTo(size.height, 6);
        for (const r of rects) {
          const v = userRectToVisualRect(box, r);
          const s = pdfRectToScreenRect(page.viewport, r);
          expect(v.left).toBeCloseTo(s.left, 6);
          expect(size.height - (v.bottom + v.height)).toBeCloseTo(s.top, 6);
          expect(v.width).toBeCloseTo(s.width, 6);
          expect(v.height).toBeCloseTo(s.height, 6);
        }
      }
    });
  }

  it('visualPointToUser inverts userPointToVisual for all rotations with an offset box', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const box: PageBox = { x: 50, y: 100, width: 400, height: 500, rotation };
      const v = userPointToVisual(box, 123, 456);
      const back = visualPointToUser(box, v.u, v.v);
      expect(back.x).toBeCloseTo(123, 9);
      expect(back.y).toBeCloseTo(456, 9);
    }
  });

  it('normalizeRotation handles negatives, wraps and odd values', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(180)).toBe(180);
    expect(normalizeRotation(269)).toBe(270);
  });
});
