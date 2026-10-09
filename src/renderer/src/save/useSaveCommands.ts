import { useEffect } from 'react';
import { useDocumentStore } from '../state/documentStore';
import { saveDocument } from './saveDocument';
import { useSaveStore } from './saveStore';

/**
 * Save orchestration, mounted once from App: Cmd/Ctrl+S, Cmd/Ctrl+Shift+S, the native menu,
 * main's "save before close" request, the dirty flag sent to main, and the window title.
 */
export function useSaveCommands(): void {
  useEffect(() => {
    const offMenu = window.api.onMenu((cmd) => {
      if (cmd === 'save') void saveDocument();
      else if (cmd === 'saveAs') void saveDocument({ saveAs: true });
    });
    const offRequest = window.api.onSaveRequest(() => saveDocument());
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      void saveDocument({ saveAs: e.shiftKey });
    };
    window.addEventListener('keydown', onKey);
    return () => {
      offMenu();
      offRequest();
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Dirty flag -> main (close guard, macOS edited dot) and window title.
  const fileName = useDocumentStore((s) => s.doc?.fileName);
  const dirty = useDocumentStore((s) => s.dirty);
  useEffect(() => {
    window.api.setDirty(dirty);
    document.title = fileName ? `${fileName}${dirty ? ' — Edited' : ''}` : 'Simple PDF';
  }, [fileName, dirty]);

  // "Saved to …" toast fades after a moment.
  const toast = useSaveStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useSaveStore.getState().setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);
}
