import { exportPdf } from '../pdf/export';
import { useDocumentStore } from '../state/documentStore';
import { baseName, defaultOutputPath } from './outputName';
import { useSaveStore } from './saveStore';

/**
 * Save (or Save As). Returns true only when the file was written. The first save is always
 * Save As; later saves go to `outputPath`. The source file is never written unless the user
 * explicitly picks it in the dialog (the native dialog confirms the replace).
 */
export async function saveDocument(opts: { saveAs?: boolean } = {}): Promise<boolean> {
  const ui = useSaveStore.getState();
  const { doc } = useDocumentStore.getState();
  if (!doc || !doc.capabilities.editable || ui.saving) return false;
  ui.setSaving(true);
  ui.setError(null);
  try {
    const path =
      (opts.saveAs ? undefined : doc.outputPath) ??
      (await window.api.savePdfDialog(defaultOutputPath(doc.sourcePath)));
    if (!path) return false;
    const { overlays, formValues } = useDocumentStore.getState();
    const bytes = await exportPdf({
      sourceBytes: doc.sourceBytes,
      overlays,
      formValues,
      pages: doc.pages,
    });
    await window.api.writePdf(path, bytes);
    useDocumentStore.getState().markSaved(path);
    ui.setToast(`Saved to ${baseName(path)}`);
    return true;
  } catch (e) {
    console.error('Save failed', e);
    ui.setError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  } finally {
    ui.setSaving(false);
  }
}

/**
 * Ask what to do with unsaved changes before replacing the open document. Returns true when it
 * is fine to continue (nothing unsaved, "Don't Save", or a successful "Save").
 */
export async function confirmDiscardChanges(): Promise<boolean> {
  const { doc, dirty } = useDocumentStore.getState();
  if (!doc || !dirty) return true;
  const choice = await window.api.confirmUnsaved(doc.fileName);
  if (choice === 'cancel') return false;
  if (choice === 'save') return saveDocument();
  return true;
}
