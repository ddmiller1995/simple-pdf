import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { PageInfo } from '@shared/types';
import { getPdfPage } from '../pdf/loader';
import { useDocumentStore } from '../state/documentStore';
import { PageView } from './PageView';
import { useViewerStore } from './viewerStore';
import { fitWidthZoom } from './zoom';

const GUTTER = 12; // px: gap between pages and padding around them

const isSideways = (p: PageInfo): boolean => p.rotation === 90 || p.rotation === 270;
const visualWidthPt = (p: PageInfo): number => (isSideways(p) ? p.heightPt : p.widthPt);
const visualHeightPt = (p: PageInfo): number => (isSideways(p) ? p.widthPt : p.heightPt);

/**
 * One page position in the scroll column. It always occupies its final size (so scrolling and the
 * page indicator are stable) and mounts the real PageView only while `active` (visible +/- 1).
 * PageView gets a real PDF.js viewport: `pdfPage.getViewport({ scale: zoom })`.
 */
function PageSlot({ page, zoom, active }: { page: PageInfo; zoom: number; active: boolean }) {
  const [pdfPage, setPdfPage] = useState<PDFPageProxy | null>(null);

  useEffect(() => {
    if (!active) {
      setPdfPage(null);
      return;
    }
    let cancelled = false;
    getPdfPage(page.index).then(
      (p) => {
        if (!cancelled) setPdfPage(p);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [active, page.index]);

  const viewport = useMemo(() => pdfPage?.getViewport({ scale: zoom }) ?? null, [pdfPage, zoom]);

  return (
    <div
      className="page-slot"
      data-page-slot={page.index}
      style={{ width: visualWidthPt(page) * zoom, height: visualHeightPt(page) * zoom }}
    >
      {active && viewport ? <PageView page={page} viewport={viewport} /> : null}
    </div>
  );
}

export function Viewer() {
  const doc = useDocumentStore((s) => s.doc);
  const zoom = useDocumentStore((s) => s.zoom);
  const loadId = useViewerStore((s) => s.loadId);
  const fitTick = useViewerStore((s) => s.fitTick);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevZoom = useRef(zoom);
  const [visible, setVisible] = useState<ReadonlySet<number>>(new Set([0]));

  // Fit width on load and on request (Cmd+0 / Fit button).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const pages = useDocumentStore.getState().doc?.pages;
    if (!el || !pages?.length) return;
    el.scrollTop = 0;
    const widest = Math.max(...pages.map(visualWidthPt));
    const fit = fitWidthZoom(el.clientWidth - 2 * GUTTER, widest);
    prevZoom.current = fit;
    useDocumentStore.getState().setZoom(fit);
  }, [loadId, fitTick]);

  // Keep the same document position when the zoom changes.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && prevZoom.current !== zoom && prevZoom.current > 0) {
      el.scrollTop = (el.scrollTop * zoom) / prevZoom.current;
    }
    prevZoom.current = zoom;
  }, [zoom]);

  // Track which slots intersect the viewport.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const seen = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset['pageSlot']);
          if (entry.isIntersecting) seen.add(index);
          else seen.delete(index);
        }
        setVisible(new Set(seen));
      },
      { root },
    );
    root.querySelectorAll('[data-page-slot]').forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [loadId, doc?.pages.length]);

  // Page indicator: the page under the middle of the viewport.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const update = (): void => {
      frame = 0;
      const mid = el.scrollTop + el.clientHeight / 2;
      const slots = el.querySelectorAll<HTMLElement>('[data-page-slot]');
      let current = 0;
      slots.forEach((s, i) => {
        if (s.offsetTop <= mid) current = i;
      });
      useViewerStore.getState().setCurrentPage(current);
    };
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [loadId, zoom]);

  const active = useMemo(() => {
    const set = new Set<number>();
    for (const i of visible) {
      set.add(i - 1);
      set.add(i);
      set.add(i + 1);
    }
    return set;
  }, [visible]);

  if (!doc) return null;
  return (
    <div className="viewer" ref={scrollRef} data-testid="viewer">
      <div className="viewer-column" style={{ gap: GUTTER, padding: GUTTER }}>
        {doc.pages.map((page) => (
          <PageSlot
            key={`${loadId}:${page.index}`}
            page={page}
            zoom={zoom}
            active={active.has(page.index)}
          />
        ))}
      </div>
    </div>
  );
}
