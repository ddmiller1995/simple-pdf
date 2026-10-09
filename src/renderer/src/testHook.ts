import { exportPdf } from './pdf/export';
import { useDocumentStore } from './state/documentStore';

/**
 * E2E-only helpers, loaded by main.tsx only when a Playwright init script sets
 * `window.__SIMPLE_PDF_E2E__`. Lets tests verify the export round-trip without the save UI.
 */
declare global {
  interface Window {
    __simplePdfTest?: {
      /** Export the current document + overlays + form values; returns the PDF bytes. */
      exportCurrent(): Promise<number[]>;
      state(): { overlays: unknown[]; dirty: boolean; pastLength: number; futureLength: number };
    };
  }
}

window.__simplePdfTest = {
  async exportCurrent() {
    const s = useDocumentStore.getState();
    if (!s.doc) throw new Error('No document open');
    const bytes = await exportPdf({
      sourceBytes: s.doc.sourceBytes,
      overlays: s.overlays,
      formValues: s.formValues,
      pages: s.doc.pages,
    });
    return Array.from(bytes);
  },
  state() {
    const s = useDocumentStore.getState();
    return {
      overlays: s.overlays,
      dirty: s.dirty,
      pastLength: s.history.past.length,
      futureLength: s.history.future.length,
    };
  },
};
