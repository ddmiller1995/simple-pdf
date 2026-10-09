import { pdfRectToScreenRect, screenRectToPdfRect } from '../pdf/coords';
import { getPdfPage } from '../pdf/loader';
import { useDocumentStore } from '../state/documentStore';
import { clampInto, moveRect, pageBounds } from '../overlays/geometry';
import { useEditStore } from '../overlays/editStore';
import { sizeAtWidth } from '../overlays/textFit';

export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 36;

const canEdit = (): boolean => useDocumentStore.getState().doc?.capabilities.editable === true;

export function selectedOverlay() {
  const { overlays, selectedId } = useDocumentStore.getState();
  return overlays.find((o) => o.id === selectedId);
}

export function deleteSelected(): void {
  const o = selectedOverlay();
  if (o && canEdit()) useDocumentStore.getState().removeOverlay(o.id);
}

/** Move the selected overlay by (dx, dy) points in screen directions (y down), kept on the page. */
export async function nudgeSelected(dx: number, dy: number): Promise<void> {
  const o = selectedOverlay();
  if (!o || !canEdit()) return;
  const viewport = (await getPdfPage(o.pageIndex)).getViewport({ scale: 1 });
  const current = useDocumentStore.getState().overlays.find((x) => x.id === o.id);
  if (!current) return;
  const start = pdfRectToScreenRect(viewport, current.rect);
  const moved = moveRect(start, dx, dy, pageBounds(viewport.width, viewport.height));
  if (moved.left === start.left && moved.top === start.top) return;
  useDocumentStore
    .getState()
    .updateOverlay(o.id, { rect: screenRectToPdfRect(viewport, moved) });
}

/** Change the font size of the selected text box (one undo step); its width is kept. */
export async function setSelectedFontSize(fontSize: number): Promise<void> {
  const o = selectedOverlay();
  if (!o || o.kind !== 'text' || !canEdit()) return;
  const size = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fontSize));
  const viewport = (await getPdfPage(o.pageIndex)).getViewport({ scale: 1 });
  const start = pdfRectToScreenRect(viewport, o.rect);
  const { height } = sizeAtWidth(o.text, size, start.width);
  const rect = clampInto({ ...start, height }, pageBounds(viewport.width, viewport.height));
  useDocumentStore.getState().updateOverlay(o.id, {
    fontSize: size,
    rect: screenRectToPdfRect(viewport, rect),
  });
}

export function doUndo(): void {
  useEditStore.getState().commit();
  useDocumentStore.getState().undo();
}

export function doRedo(): void {
  useEditStore.getState().commit();
  useDocumentStore.getState().redo();
}
