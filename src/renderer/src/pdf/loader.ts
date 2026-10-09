import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// PDF.js setup. Everything is loaded from local files: the worker via a Vite `?url` import, and
// cmaps / standard fonts / wasm / icc profiles from `pdfjs/` in the renderer output (copied out of
// `pdfjs-dist` by the `pdfjsAssets` plugin in electron.vite.config.ts). Scripting is never enabled
// (the quickjs sandbox is not shipped). pdfjs-dist 6 removed the `isEvalSupported` option: it no
// longer uses eval at all.
GlobalWorkerOptions.workerSrc = workerUrl;

const assetBase = (dir: string): string => new URL(`./pdfjs/${dir}/`, document.baseURI).href;

let currentDoc: PDFDocumentProxy | null = null;
let pageCache = new Map<number, Promise<PDFPageProxy>>();

/** Load a document and make it the current one (the previous one is destroyed). */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const task = getDocument({
    // PDF.js transfers the buffer to its worker; pass a copy so the caller's bytes stay intact.
    data: bytes.slice(),
    cMapUrl: assetBase('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: assetBase('standard_fonts'),
    wasmUrl: assetBase('wasm'),
    iccUrl: assetBase('iccs'),
  });
  const doc = await task.promise;
  const previous = currentDoc;
  currentDoc = doc;
  pageCache = new Map();
  if (previous) void previous.loadingTask.destroy();
  return doc;
}

/** The currently open PDF.js document, or null when nothing is open. */
export function getPdfDocument(): PDFDocumentProxy | null {
  return currentDoc;
}

/** Cached page proxy for a 0-based page index of the current document. */
export function getPdfPage(pageIndex: number): Promise<PDFPageProxy> {
  const doc = currentDoc;
  if (!doc) return Promise.reject(new Error('No PDF is open'));
  let page = pageCache.get(pageIndex);
  if (!page) {
    page = doc.getPage(pageIndex + 1);
    pageCache.set(pageIndex, page);
  }
  return page;
}
