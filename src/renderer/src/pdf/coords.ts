import type { PageViewport } from 'pdfjs-dist';
import type { PdfRect } from '@shared/types';

// The ONLY module that does screen <-> PDF coordinate math (plan §4.1).
//
// Two frames are used:
//  - USER SPACE: PDF points, origin bottom-left of the UNROTATED page (absolute, i.e. it
//    includes the CropBox offset). This is how overlays are stored.
//  - VISUAL frame: points, origin bottom-left of the page as displayed (after /Rotate and
//    CropBox), y up. Text flows left to right here, and export draws in it.
// Screen pixels are the visual frame flipped vertically and scaled by the viewport scale.

/** A rectangle in screen/CSS pixels relative to the page's top-left corner. */
export type ScreenRect = { left: number; top: number; width: number; height: number };

/** A rectangle in the visual frame (points, y up): `bottom` is the lower edge. */
export type VisualRect = { left: number; bottom: number; width: number; height: number };

export type Rotation = 0 | 90 | 180 | 270;

/** The visible page area (CropBox ∩ MediaBox, absolute user space) and the page's /Rotate. */
export type PageBox = { x: number; y: number; width: number; height: number; rotation: Rotation };

// ---- Screen <-> user space (PDF.js viewport) -------------------------------------------------

/** Screen rect (CSS px, relative to the page's top-left) -> overlay rect in user space. */
export function screenRectToPdfRect(viewport: PageViewport, domRect: ScreenRect): PdfRect {
  const [x1, y1] = viewport.convertToPdfPoint(domRect.left, domRect.top);
  const [x2, y2] = viewport.convertToPdfPoint(
    domRect.left + domRect.width,
    domRect.top + domRect.height,
  );
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/** Overlay rect in user space -> screen rect (CSS px, relative to the page's top-left). */
export function pdfRectToScreenRect(viewport: PageViewport, rect: PdfRect): ScreenRect {
  const [x1, y1] = viewport.convertToViewportPoint(rect.x, rect.y);
  const [x2, y2] = viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height);
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/** Screen point (CSS px, relative to the page's top-left) -> user-space point. */
export function screenPointToPdfPoint(
  viewport: PageViewport,
  left: number,
  top: number,
): { x: number; y: number } {
  const [x, y] = viewport.convertToPdfPoint(left, top);
  return { x, y };
}

/** User-space point -> screen point (CSS px, relative to the page's top-left). */
export function pdfPointToScreenPoint(
  viewport: PageViewport,
  x: number,
  y: number,
): { left: number; top: number } {
  const [left, top] = viewport.convertToViewportPoint(x, y);
  return { left, top };
}

// ---- User space <-> visual frame (no viewport needed; used by export) ------------------------

/** Normalise any /Rotate value (negative, >= 360, non-multiples of 90) to 0/90/180/270. */
export function normalizeRotation(angle: number): Rotation {
  const a = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  return a as Rotation;
}

/** Displayed page size in points (width and height swap for 90/270). */
export function visualSize(box: PageBox): { width: number; height: number } {
  return box.rotation === 90 || box.rotation === 270
    ? { width: box.height, height: box.width }
    : { width: box.width, height: box.height };
}

/** User-space point -> visual frame point (points, origin bottom-left of the displayed page). */
export function userPointToVisual(box: PageBox, x: number, y: number): { u: number; v: number } {
  const dx = x - box.x;
  const dy = y - box.y;
  switch (box.rotation) {
    case 0:
      return { u: dx, v: dy };
    case 90:
      return { u: dy, v: box.width - dx };
    case 180:
      return { u: box.width - dx, v: box.height - dy };
    case 270:
      return { u: box.height - dy, v: dx };
  }
}

/** Visual frame point -> user-space point. Inverse of `userPointToVisual`. */
export function visualPointToUser(box: PageBox, u: number, v: number): { x: number; y: number } {
  switch (box.rotation) {
    case 0:
      return { x: box.x + u, y: box.y + v };
    case 90:
      return { x: box.x + box.width - v, y: box.y + u };
    case 180:
      return { x: box.x + box.width - u, y: box.y + box.height - v };
    case 270:
      return { x: box.x + v, y: box.y + box.height - u };
  }
}

/** User-space rect -> the same area in the visual frame (axis-aligned for all rotations). */
export function userRectToVisualRect(box: PageBox, rect: PdfRect): VisualRect {
  const a = userPointToVisual(box, rect.x, rect.y);
  const b = userPointToVisual(box, rect.x + rect.width, rect.y + rect.height);
  return {
    left: Math.min(a.u, b.u),
    bottom: Math.min(a.v, b.v),
    width: Math.abs(b.u - a.u),
    height: Math.abs(b.v - a.v),
  };
}
