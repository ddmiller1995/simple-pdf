import type { ImageOverlay } from '@shared/types';

// T0 stub (T5 owns).
export function ImageBox({ overlay }: { overlay: ImageOverlay }) {
  return <img data-overlay-id={overlay.id} src={overlay.pngDataUrl} alt="Signature" />;
}
