import type { ImageOverlay, SavedSignature } from '@shared/types';
import { screenRectToPdfRect } from '../pdf/coords';
import { getPdfPage } from '../pdf/loader';
import { useDocumentStore } from '../state/documentStore';
import { useViewerStore } from '../viewer/viewerStore';
import { centeredRect, pageBounds } from './geometry';

/** Default placed width in points (plan T5). */
export const SIGNATURE_WIDTH_PT = 150;
export const INITIALS_WIDTH_PT = 60;

async function naturalSize(dataUrl: string): Promise<{ width: number; height: number }> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return { width: img.naturalWidth || 1, height: img.naturalHeight || 1 };
}

/**
 * Add `sig` to page `pageIndex`, centred on a point given in screen px relative to the page's
 * top-left (at the current zoom) and clamped to the page. Returns the new overlay.
 */
export async function placeSignature(
  sig: SavedSignature,
  pageIndex: number,
  center: { left: number; top: number },
): Promise<ImageOverlay | null> {
  if (!useDocumentStore.getState().doc?.capabilities.editable) return null;
  const [pdfPage, size] = await Promise.all([getPdfPage(pageIndex), naturalSize(sig.pngDataUrl)]);
  const viewport = pdfPage.getViewport({ scale: useDocumentStore.getState().zoom });
  const bounds = pageBounds(viewport.width, viewport.height);

  let width = (sig.kind === 'initials' ? INITIALS_WIDTH_PT : SIGNATURE_WIDTH_PT) * viewport.scale;
  let height = (width * size.height) / size.width;
  const fit = Math.min(1, (0.9 * viewport.width) / width, (0.9 * viewport.height) / height);
  width *= fit;
  height *= fit;

  const screen = centeredRect(center.left, center.top, width, height, bounds);
  const overlay: ImageOverlay = {
    kind: 'image',
    id: crypto.randomUUID(),
    pageIndex,
    rect: screenRectToPdfRect(viewport, screen),
    signatureId: sig.id,
    pngDataUrl: sig.pngDataUrl,
  };
  const s = useDocumentStore.getState();
  s.addOverlay(overlay);
  s.select(overlay.id);
  s.setTool('select');
  return overlay;
}

/** Centre of the part of page `pageIndex` that is scrolled into view (page-relative px). */
export function visibleCenter(pageIndex: number): { left: number; top: number } | null {
  const slot = document.querySelector<HTMLElement>(`[data-page-slot="${pageIndex}"]`);
  const viewer = document.querySelector<HTMLElement>('[data-testid="viewer"]');
  if (!slot) return null;
  const s = slot.getBoundingClientRect();
  const v = viewer?.getBoundingClientRect() ?? s;
  const top = Math.max(s.top, v.top);
  const bottom = Math.min(s.bottom, v.bottom);
  const left = Math.max(s.left, v.left);
  const right = Math.min(s.right, v.right);
  if (bottom <= top || right <= left) return { left: s.width / 2, top: s.height / 2 };
  return { left: (left + right) / 2 - s.left, top: (top + bottom) / 2 - s.top };
}

/** Click on a thumbnail: place on the visible page, centred in the visible part. */
export async function placeSignatureOnVisiblePage(sig: SavedSignature): Promise<void> {
  const pageIndex = useViewerStore.getState().currentPage;
  const center = visibleCenter(pageIndex);
  if (center) await placeSignature(sig, pageIndex, center);
}

/** Drop at window coordinates: lands on the page under the pointer, if any. */
export async function placeSignatureAtClient(
  sig: SavedSignature,
  clientX: number,
  clientY: number,
): Promise<boolean> {
  const pageEl = document
    .elementsFromPoint(clientX, clientY)
    .find(
      (el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('page-view'),
    );
  if (!pageEl) return false;
  const rect = pageEl.getBoundingClientRect();
  const placed = await placeSignature(sig, Number(pageEl.dataset['pageIndex']), {
    left: clientX - rect.left,
    top: clientY - rect.top,
  });
  return placed !== null;
}
