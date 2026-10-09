import type { LayerProps } from './layerProps';

// T0 stub. T1 renders the PDF.js page bitmap here (HiDPI: canvas px = CSS px * devicePixelRatio).
export function CanvasLayer(_props: LayerProps) {
  return <div className="page-layer canvas-layer" data-testid="canvas-layer" />;
}
