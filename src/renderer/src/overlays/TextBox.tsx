import type { TextOverlay } from '@shared/types';

// T0 stub (T5 owns).
export function TextBox({ overlay }: { overlay: TextOverlay }) {
  return <div data-overlay-id={overlay.id}>{overlay.text}</div>;
}
