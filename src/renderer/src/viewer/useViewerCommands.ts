import { useEffect } from 'react';
import { useDocumentStore } from '../state/documentStore';
import { openPath, openWithDialog } from './openDocument';
import { useViewerStore } from './viewerStore';
import { clampZoom, zoomIn, zoomOut } from './zoom';

export function applyZoom(kind: 'in' | 'out'): void {
  const { zoom, setZoom, doc } = useDocumentStore.getState();
  if (!doc) return;
  setZoom(clampZoom(kind === 'in' ? zoomIn(zoom) : zoomOut(zoom)));
}

/** Open / zoom commands from the native menu, Finder open-file events and keyboard shortcuts. */
export function useViewerCommands(): void {
  useEffect(() => {
    const offMenu = window.api.onMenu((cmd) => {
      if (cmd === 'open') void openWithDialog();
      else if (cmd === 'zoomIn') applyZoom('in');
      else if (cmd === 'zoomOut') applyZoom('out');
      else if (cmd === 'zoomFit') useViewerStore.getState().requestFit();
    });
    const offOpen = window.api.onOpenFile((path) => void openPath(path));

    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key === '=' || e.key === '+') applyZoom('in');
      else if (e.key === '-') applyZoom('out');
      else if (e.key === '0') useViewerStore.getState().requestFit();
      else if (e.key === 'o') void openWithDialog();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      offMenu();
      offOpen();
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}
