import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

// T0 stub. T1 configures PDF.js (local worker, cMapUrl, standardFontDataUrl, wasmUrl,
// isEvalSupported: false, enableScripting: false) and returns the loaded document.
// loadPdf also becomes the "current" document, which other layers read via the getters below.
export function loadPdf(_bytes: Uint8Array): Promise<PDFDocumentProxy> {
  throw new Error('NotImplemented: loadPdf');
}

/** The currently open PDF.js document, or null when nothing is open. */
export function getPdfDocument(): PDFDocumentProxy | null {
  return null;
}

/** Cached page proxy for a 0-based page index of the current document. */
export function getPdfPage(_pageIndex: number): Promise<PDFPageProxy> {
  throw new Error('NotImplemented: getPdfPage');
}
