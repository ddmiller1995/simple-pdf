import { saveDocument } from '../save/saveDocument';
import { useEffect, useRef, useState } from 'react';
import { MAX_FONT_SIZE, MIN_FONT_SIZE, setSelectedFontSize } from '../edit/editActions';
import { placeSignatureAtClient, placeSignatureOnVisiblePage } from '../overlays/placement';
import { SignaturePanel } from '../signature/SignaturePanel';
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
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36];

/** T5: Select / Text tools, the Sign popover and (for a selected text box) the font size. */
function EditTools() {
  const doc = useDocumentStore((s) => s.doc);
  const tool = useDocumentStore((s) => s.tool);
  const setTool = useDocumentStore((s) => s.setTool);
  const selectedText = useDocumentStore((s) => {
    const o = s.overlays.find((x) => x.id === s.selectedId);
    return o?.kind === 'text' ? o : undefined;
  });
  const [signOpen, setSignOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const enabled = doc?.capabilities.editable === true;

  useEffect(() => {
    if (!signOpen) return;
    const onDown = (e: PointerEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setSignOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) setSignOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [signOpen]);

  useEffect(() => {
    if (!enabled) setSignOpen(false);
  }, [enabled]);

  const sizes =
    selectedText && !FONT_SIZES.includes(selectedText.fontSize)
      ? [...FONT_SIZES, selectedText.fontSize].sort((a, b) => a - b)
      : FONT_SIZES;

  return (
    <>
      <button
        type="button"
        data-testid="tool-select"
        aria-pressed={tool === 'select'}
        title="Select (V)"
        disabled={!enabled}
        onClick={() => setTool('select')}
      >
        Select
      </button>
      <button
        type="button"
        data-testid="tool-text"
        aria-pressed={tool === 'text'}
        title="Text (T)"
        disabled={!enabled}
        onClick={() => setTool('text')}
      >
        Text
      </button>
      <div className="sign-wrap" ref={wrapRef}>
        <button
          type="button"
          data-testid="sign-button"
          aria-expanded={signOpen}
          title="Sign"
          disabled={!enabled}
          onClick={() => setSignOpen((v) => !v)}
        >
          Sign
        </button>
        {signOpen && (
          <div className="sig-popover" data-testid="sign-popover">
            <SignaturePanel
              onPick={(sig) => {
                setSignOpen(false);
                void placeSignatureOnVisiblePage(sig);
              }}
              onDrop={(sig, x, y) => {
                setSignOpen(false);
                void placeSignatureAtClient(sig, x, y);
              }}
            />
          </div>
        )}
      </div>
      {selectedText && enabled && (
        <label className="font-size-control">
          Size
          <select
            data-testid="font-size"
            value={selectedText.fontSize}
            aria-label={`Font size (${MIN_FONT_SIZE}-${MAX_FONT_SIZE} pt)`}
            onChange={(e) => void setSelectedFontSize(Number(e.target.value))}
          >
            {sizes.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

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

      <div className="toolbar-group toolbar-tools"><EditTools /></div>

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

      <div className="toolbar-group toolbar-end">
        <button
          type="button"
          title="Save (Cmd+S)"
          data-testid="save-button"
          disabled={!doc || !doc.capabilities.editable}
          onClick={() => void saveDocument()}
        >
          Save
        </button>
      </div>
    </div>
  );
}
