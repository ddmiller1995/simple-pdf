import { useEffect, useRef } from 'react';
import { AnnotationMode } from 'pdfjs-dist';
import { getPdfPage } from '../pdf/loader';
import type { LayerProps } from './layerProps';

/** Cap on backing-store pixels per page so 400% zoom on a HiDPI display stays bounded. */
const MAX_CANVAS_PIXELS = 16_000_000;

/** Renders the PDF.js page bitmap. Canvas px = CSS px * devicePixelRatio (capped). */
export function CanvasLayer({ page, viewport }: LayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<void> } | null = null;

    void (async () => {
      try {
        const pdfPage = await getPdfPage(page.index);
        if (cancelled) return;
        const cssW = viewport.width;
        const cssH = viewport.height;
        const dpr = Math.min(
          window.devicePixelRatio || 1,
          Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, cssW * cssH)),
        );
        // Backing-store size; the render viewport is the layer viewport scaled by dpr.
        const renderViewport = pdfPage.getViewport({ scale: viewport.scale * dpr });
        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        task = pdfPage.render({
          canvas,
          viewport: renderViewport,
          // Form widgets are drawn by FormLayer (HTML inputs), not baked into the bitmap.
          annotationMode: AnnotationMode.ENABLE_FORMS,
        });
        await task.promise;
      } catch (e) {
        if (e instanceof Error && e.name === 'RenderingCancelledException') return;
        if (!cancelled) console.error(`Failed to render page ${page.index + 1}`, e);
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [page.index, viewport]);

  // Release the backing store when the layer goes away (page scrolled far off-screen).
  useEffect(() => {
    const canvas = canvasRef.current;
    return () => {
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, []);

  return (
    <div className="page-layer canvas-layer" data-testid="canvas-layer">
      <canvas ref={canvasRef} />
    </div>
  );
}
