import type { PDFDocumentProxy } from 'pdfjs-dist';

// T0 stub. T1 configures PDF.js (local worker, cMapUrl, standardFontDataUrl, wasmUrl,
// isEvalSupported: false) and returns the loaded document.
export function loadPdf(_bytes: Uint8Array): Promise<PDFDocumentProxy> {
  throw new Error('NotImplemented: loadPdf');
}
