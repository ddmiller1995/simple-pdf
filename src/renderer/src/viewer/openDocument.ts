import { useDocumentStore } from '../state/documentStore';
import { detectCapabilities } from '../pdf/forms';
import { getPdfPage, loadPdf } from '../pdf/loader';
import { confirmDiscardChanges } from '../save/saveDocument';
import type { PageInfo } from '@shared/types';
import { useViewerStore } from './viewerStore';

function friendlyError(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  if (name === 'PasswordException') {
    return 'This PDF is password-protected, which Simple PDF cannot open yet.';
  }
  return "Couldn't open this file. It may be damaged or not a PDF.";
}

/** Load bytes into PDF.js and the store. On failure the previous document stays open. */
export async function openPdfBytes(path: string, bytes: Uint8Array): Promise<boolean> {
  if (!(await confirmDiscardChanges())) return false; // T6: unsaved-changes prompt
  useViewerStore.getState().setOpenError(null);
  try {
    const pdf = await loadPdf(bytes);
    const pages: PageInfo[] = [];
    for (let i = 0; i < pdf.numPages; i++) {
      const p = await getPdfPage(i);
      const [x0, y0, x1, y1] = p.view;
      const rotation = (((p.rotate % 360) + 360) % 360) as PageInfo['rotation'];
      pages.push({ index: i, widthPt: x1 - x0, heightPt: y1 - y0, rotation });
    }
    const capabilities = await detectCapabilities(pdf, bytes);
    useViewerStore.getState().bumpLoad();
    useDocumentStore.getState().loadDocument({
      fileName: path.split(/[\\/]/).pop() || path,
      sourcePath: path,
      sourceBytes: bytes,
      pages,
      capabilities,
    });
    return true;
  } catch (e) {
    console.error('Failed to open PDF', e);
    useViewerStore.getState().setOpenError(friendlyError(e));
    return false;
  }
}

/** Native open dialog (toolbar / menu / Cmd+O). */
export async function openWithDialog(): Promise<void> {
  try {
    const result = await window.api.openPdfDialog();
    if (result) await openPdfBytes(result.path, result.bytes);
  } catch (e) {
    console.error(e);
    useViewerStore.getState().setOpenError("Couldn't open this file.");
  }
}

/** Open by path (Finder "Open With", second instance). */
export async function openPath(path: string): Promise<void> {
  try {
    await openPdfBytes(path, await window.api.readPdf(path));
  } catch (e) {
    console.error(e);
    useViewerStore.getState().setOpenError("Couldn't open this file.");
  }
}

/** Open a dropped File. The sandboxed renderer has no path, so read its bytes directly. */
export async function openDroppedFile(file: File): Promise<void> {
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    useViewerStore.getState().setOpenError('That file is not a PDF.');
    return;
  }
  // T6: the preload resolves the real path (empty for synthetic Files), so Save As can default
  // to the source directory.
  const path = window.api.getPathForFile(file) || file.name;
  await openPdfBytes(path, new Uint8Array(await file.arrayBuffer()));
}
