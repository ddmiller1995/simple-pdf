import type { PageViewport } from 'pdfjs-dist';
import type { PageInfo } from '@shared/types';
import { useDocumentStore } from '../state/documentStore';
import { PageView } from './PageView';

/**
 * T0 stub. T1 replaces this with lazy rendering, zoom handling and the page indicator, and builds
 * real viewports from `pdfPage.getViewport()` (PageViewport is exported by pdfjs-dist as a TYPE
 * only, so it cannot be constructed directly). The fake below only carries what the stub reads.
 */
function stubViewport(page: PageInfo, scale: number): PageViewport {
  const swap = page.rotation === 90 || page.rotation === 270;
  const w = swap ? page.heightPt : page.widthPt;
  const h = swap ? page.widthPt : page.heightPt;
  return { width: w * scale, height: h * scale, scale, rotation: page.rotation } as PageViewport;
}

export function Viewer() {
  const doc = useDocumentStore((s) => s.doc);
  const zoom = useDocumentStore((s) => s.zoom);
  if (!doc) return null;
  return (
    <div className="viewer">
      {doc.pages.map((page) => (
        <PageView key={page.index} page={page} viewport={stubViewport(page, zoom)} />
      ))}
    </div>
  );
}
