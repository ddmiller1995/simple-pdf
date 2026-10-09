import type { ScreenRect } from '../pdf/coords';

// Pure screen-space geometry for overlay dragging and resizing. All rects are in CSS px relative
// to the page's top-left (the page always looks upright on screen, whatever its /Rotate), so no
// rotation handling is needed here; callers convert to/from PDF user space with pdf/coords.ts.

export type Corner = 'nw' | 'ne' | 'sw' | 'se';
export type Bounds = { left: number; top: number; right: number; bottom: number };

export const pageBounds = (width: number, height: number): Bounds => ({
  left: 0,
  top: 0,
  right: width,
  bottom: height,
});

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Shift `rect` so it lies inside `b` (a rect larger than `b` is pinned to its top-left). */
export function clampInto(rect: ScreenRect, b: Bounds): ScreenRect {
  return {
    ...rect,
    left: clamp(rect.left, b.left, b.right - rect.width),
    top: clamp(rect.top, b.top, b.bottom - rect.height),
  };
}

/** Move by (dx, dy), constrained to the page. */
export function moveRect(rect: ScreenRect, dx: number, dy: number, b: Bounds): ScreenRect {
  return clampInto({ ...rect, left: rect.left + dx, top: rect.top + dy }, b);
}

/** A rect of the given size centred on (cx, cy), constrained to the page. */
export function centeredRect(
  cx: number,
  cy: number,
  width: number,
  height: number,
  b: Bounds,
): ScreenRect {
  return clampInto({ left: cx - width / 2, top: cy - height / 2, width, height }, b);
}

const isEast = (c: Corner): boolean => c === 'ne' || c === 'se';
const isSouth = (c: Corner): boolean => c === 'sw' || c === 'se';

/**
 * Drag `corner` of `start` by (dx, dy) keeping the aspect ratio; the opposite corner stays fixed.
 * The result is at least `minWidth` wide and never leaves the page.
 */
export function resizeAspect(
  start: ScreenRect,
  corner: Corner,
  dx: number,
  dy: number,
  b: Bounds,
  minWidth: number,
): ScreenRect {
  const east = isEast(corner);
  const south = isSouth(corner);
  const anchorX = east ? start.left : start.left + start.width;
  const anchorY = south ? start.top : start.top + start.height;
  const wantW = start.width + (east ? dx : -dx);
  const wantH = start.height + (south ? dy : -dy);
  const maxW = east ? b.right - anchorX : anchorX - b.left;
  const maxH = south ? b.bottom - anchorY : anchorY - b.top;
  const maxScale = Math.min(maxW / start.width, maxH / start.height);
  const minScale = Math.min(minWidth / start.width, maxScale);
  const scale = clamp((wantW / start.width + wantH / start.height) / 2, minScale, maxScale);
  const width = start.width * scale;
  const height = start.height * scale;
  return {
    left: east ? anchorX : anchorX - width,
    top: south ? anchorY : anchorY - height,
    width,
    height,
  };
}

/**
 * Drag a corner of a text box: only the width changes (text re-wraps). Right corners move the
 * right edge, left corners the left edge; the opposite edge is fixed. Height and top are left to
 * the caller (the height depends on the wrapped text).
 */
export function resizeWidth(
  start: ScreenRect,
  corner: Corner,
  dx: number,
  b: Bounds,
  minWidth: number,
): { left: number; width: number } {
  if (isEast(corner)) {
    const width = clamp(start.width + dx, minWidth, b.right - start.left);
    return { left: start.left, width };
  }
  const right = start.left + start.width;
  const width = clamp(start.width - dx, minWidth, right - b.left);
  return { left: right - width, width };
}
