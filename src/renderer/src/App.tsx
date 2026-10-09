import { useEffect, useState } from 'react';
import { Toolbar } from './toolbar/Toolbar';
import { Viewer } from './viewer/Viewer';
import { useDocumentStore } from './state/documentStore';
import { openDroppedFile } from './viewer/openDocument';
import { useEditCommands } from './edit/useEditCommands';
import { useViewerCommands } from './viewer/useViewerCommands';
import { useViewerStore } from './viewer/viewerStore';
import { SaveStatus } from './save/SaveStatus';
import { useSaveCommands } from './save/useSaveCommands';

const hasFiles = (e: DragEvent): boolean => e.dataTransfer?.types.includes('Files') ?? false;

export function App() {
  const hasDoc = useDocumentStore((s) => s.doc !== null);
  const openError = useViewerStore((s) => s.openError);
  const [dragging, setDragging] = useState(false);
  useViewerCommands();
  useSaveCommands();
  useEditCommands();

  // Drop a PDF anywhere on the window to open it. The renderer has no file paths under the
  // sandbox, so the File's bytes are read here.
  useEffect(() => {
    let depth = 0;
    const onEnter = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent): void => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) void openDroppedFile(file);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <div className={dragging ? 'app dragging' : 'app'}>
      <Toolbar />
      <SaveStatus />
      {openError ? (
        <div className="error-banner" role="alert" data-testid="open-error">
          <span>{openError}</span>
          <button type="button" onClick={() => useViewerStore.getState().setOpenError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {hasDoc ? <Viewer /> : <div className="empty-state">Open a PDF or drag one here</div>}
    </div>
  );
}
