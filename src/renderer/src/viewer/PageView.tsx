import { CanvasLayer } from './CanvasLayer';
import { FormLayer } from './FormLayer';
import { OverlayLayer } from './OverlayLayer';
import type { LayerProps } from './layerProps';

/** Stacks CanvasLayer (PDF.js bitmap) -> FormLayer (AcroForm inputs) -> OverlayLayer (ours). */
export function PageView({ page, viewport }: LayerProps) {
  return (
    <div
      className="page-view"
      data-page-index={page.index}
      style={{ width: viewport.width, height: viewport.height }}
    >
      <CanvasLayer page={page} viewport={viewport} />
      <FormLayer page={page} viewport={viewport} />
      <OverlayLayer page={page} viewport={viewport} />
    </div>
  );
}
