import type { PageViewport } from 'pdfjs-dist';
import type { PdfRect } from '@shared/types';

// T0 stub. T2 implements these on top of viewport.convertToPdfPoint / convertToViewportPoint.
// This is the ONLY module that does screen <-> PDF coordinate math.

export type ScreenRect = { left: number; top: number; width: number; height: number };

export function screenRectToPdfRect(_viewport: PageViewport, _domRect: ScreenRect): PdfRect {
  throw new Error('NotImplemented: screenRectToPdfRect');
}

export function pdfRectToScreenRect(_viewport: PageViewport, _rect: PdfRect): ScreenRect {
  throw new Error('NotImplemented: pdfRectToScreenRect');
}
