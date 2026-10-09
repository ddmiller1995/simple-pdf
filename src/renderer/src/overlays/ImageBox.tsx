import type { ImageOverlay } from '@shared/types';

/** Signature image filling its positioned parent (aspect is locked by the geometry helpers). */
export function ImageBox({ overlay }: { overlay: ImageOverlay }) {
  return <img className="image-box" src={overlay.pngDataUrl} alt="Signature" draggable={false} />;
}
