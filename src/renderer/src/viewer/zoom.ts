export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Next preset above `zoom` (or MAX_ZOOM). */
export function zoomIn(zoom: number): number {
  return ZOOM_STEPS.find((s) => s > zoom + 1e-6) ?? MAX_ZOOM;
}

/** Next preset below `zoom` (or MIN_ZOOM). */
export function zoomOut(zoom: number): number {
  return [...ZOOM_STEPS].reverse().find((s) => s < zoom - 1e-6) ?? MIN_ZOOM;
}

/** Scale at which the widest page exactly fills `availableWidth` CSS px. */
export function fitWidthZoom(availableWidth: number, widestPagePt: number): number {
  if (!(availableWidth > 0) || !(widestPagePt > 0)) return 1;
  return clampZoom(availableWidth / widestPagePt);
}
