import { useDocumentStore } from '../state/documentStore';
import { openWithDialog } from '../viewer/openDocument';
import { applyZoom } from '../viewer/useViewerCommands';
import { useViewerStore } from '../viewer/viewerStore';

/**
 * T1: Open, zoom and page indicator. Layout is three groups so later tasks only fill their own:
 *  - left: Open (+ T5 adds its tool buttons in `toolbar-tools`)
 *  - middle: zoom + page indicator
 *  - right: `toolbar-end` is reserved for T6's Save button
 */
export function Toolbar() {
  const doc = useDocumentStore((s) => s.doc);
  const zoom = useDocumentStore((s) => s.zoom);
  const currentPage = useViewerStore((s) => s.currentPage);
  const hasDoc = doc !== null;

  return (
    <div className="toolbar" role="toolbar" aria-label="Main toolbar">
      <div className="toolbar-group">
        <button type="button" onClick={() => void openWithDialog()} data-testid="open-button">
          Open
        </button>
      </div>

      <div className="toolbar-group toolbar-tools">{/* T5: Select / Text / Signature tools */}</div>

      <div className="toolbar-spacer" />

      <div className="toolbar-group" aria-label="Zoom">
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out (Cmd+-)"
          disabled={!hasDoc}
          onClick={() => applyZoom('out')}
        >
          &minus;
        </button>
        <span className="zoom-label" data-testid="zoom-label" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in (Cmd+=)"
          disabled={!hasDoc}
          onClick={() => applyZoom('in')}
        >
          +
        </button>
        <button
          type="button"
          title="Fit width (Cmd+0)"
          disabled={!hasDoc}
          onClick={() => useViewerStore.getState().requestFit()}
        >
          Fit
        </button>
      </div>

      <span className="page-indicator" data-testid="page-indicator" aria-live="polite">
        {doc ? `${currentPage + 1} / ${doc.pages.length}` : ''}
      </span>

      <div className="toolbar-group toolbar-end">{/* T6: Save */}</div>
    </div>
  );
}
