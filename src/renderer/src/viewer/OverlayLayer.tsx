import { useMemo, useRef, useState } from 'react';
import type { Overlay, TextOverlay } from '@shared/types';
import { pdfRectToScreenRect, screenRectToPdfRect, type ScreenRect } from '../pdf/coords';
import { lineHeight } from '../pdf/textLayout';
import { useDocumentStore } from '../state/documentStore';
import { ImageBox } from '../overlays/ImageBox';
import { SelectionHandles } from '../overlays/SelectionHandles';
import { TextBox } from '../overlays/TextBox';
import { TextEditor } from '../overlays/TextEditor';
import { useEditStore } from '../overlays/editStore';
import { useTextReady } from '../overlays/textReady';
import {
  clampInto,
  moveRect,
  pageBounds,
  resizeAspect,
  resizeWidth,
  type Corner,
} from '../overlays/geometry';
import { sizeAtWidth } from '../overlays/textFit';
import '../overlays/overlays.css';
import type { LayerProps } from './layerProps';

const DEFAULT_FONT_SIZE = 12;
const DRAG_THRESHOLD_PX = 3;

type Drag = {
  id: string;
  mode: 'move' | Corner;
  px: number;
  py: number;
  start: ScreenRect;
  rect: ScreenRect;
  moved: boolean;
};

/**
 * Our text boxes and signature images for one page. Geometry is stored in PDF user space and
 * derived from the current viewport on every render, so zoom needs no bookkeeping. A drag or
 * resize is previewed in local state and committed to the store once, on pointer-up.
 */
export function OverlayLayer({ page, viewport }: LayerProps) {
  const allOverlays = useDocumentStore((s) => s.overlays);
  const tool = useDocumentStore((s) => s.tool);
  const selectedId = useDocumentStore((s) => s.selectedId);
  const editable = useDocumentStore((s) => s.doc?.capabilities.editable === true);
  const session = useEditStore((s) => s.session);
  const textReady = useTextReady();
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const scale = viewport.scale;
  const bounds = pageBounds(viewport.width, viewport.height);
  const overlays = useMemo(
    () => allOverlays.filter((o) => o.pageIndex === page.index),
    [allOverlays, page.index],
  );
  const textMode = tool === 'text' && editable && textReady;
  const editingHere = session && session.overlay.pageIndex === page.index ? session : null;

  const setDragBoth = (d: Drag | null): void => {
    dragRef.current = d;
    setDrag(d);
  };

  const beginDrag = (e: React.PointerEvent<HTMLElement>, o: Overlay, mode: Drag['mode']): void => {
    if (e.button !== 0 || !editable) return;
    e.stopPropagation();
    useDocumentStore.getState().select(o.id);
    if (textMode && mode === 'move') return; // text tool: a click edits, it does not drag
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = pdfRectToScreenRect(viewport, o.rect);
    setDragBoth({ id: o.id, mode, px: e.clientX, py: e.clientY, start, rect: start, moved: false });
  };

  const onMove = (e: React.PointerEvent, o: Overlay): void => {
    const d = dragRef.current;
    if (!d || d.id !== o.id) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    let rect: ScreenRect;
    if (d.mode === 'move') {
      rect = moveRect(d.start, dx, dy, bounds);
    } else if (o.kind === 'image') {
      rect = resizeAspect(d.start, d.mode, dx, dy, bounds, 12 * scale);
    } else {
      const w = resizeWidth(d.start, d.mode, dx, bounds, o.fontSize * 1.5 * scale);
      const height = sizeAtWidth(o.text, o.fontSize, w.width / scale).height * scale;
      rect = clampInto({ left: w.left, top: d.start.top, width: w.width, height }, bounds);
    }
    setDragBoth({ ...d, rect, moved: true });
  };

  const endDrag = (e: React.PointerEvent<HTMLElement>, o: Overlay, commit: boolean): void => {
    const d = dragRef.current;
    if (!d || d.id !== o.id) return;
    setDragBoth(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (commit && d.moved) {
      useDocumentStore.getState().updateOverlay(o.id, {
        rect: screenRectToPdfRect(viewport, d.rect),
      });
    }
  };

  const startEditing = (o: TextOverlay): void => {
    if (editable) useEditStore.getState().startEdit(o);
  };

  const onLayerClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!textMode || e.target !== e.currentTarget) return;
    const box = e.currentTarget.getBoundingClientRect();
    const lh = lineHeight(DEFAULT_FONT_SIZE) * scale;
    const rect = clampInto(
      {
        left: e.clientX - box.left,
        top: e.clientY - box.top - lh / 2,
        width: DEFAULT_FONT_SIZE * 4 * scale,
        height: lh,
      },
      bounds,
    );
    useEditStore.getState().startNew({
      kind: 'text',
      id: crypto.randomUUID(),
      pageIndex: page.index,
      rect: screenRectToPdfRect(viewport, rect),
      text: '',
      fontSize: DEFAULT_FONT_SIZE,
      color: [0, 0, 0],
    });
  };

  const items: { overlay: Overlay; editing: boolean }[] = (textReady ? overlays : []).map((o) => ({
    overlay: editingHere && editingHere.overlay.id === o.id ? editingHere.overlay : o,
    editing: editingHere?.overlay.id === o.id,
  }));
  if (editingHere?.isNew) items.push({ overlay: editingHere.overlay, editing: true });

  return (
    <div
      className={`page-layer overlay-layer${textMode ? ' text-mode' : ''}`}
      data-testid="overlay-layer"
      onClick={onLayerClick}
    >
      {items.map(({ overlay: o, editing }) => {
        const dragging = drag?.id === o.id && drag.moved;
        const rect = dragging ? drag.rect : pdfRectToScreenRect(viewport, o.rect);
        const selected = !editing && o.id === selectedId;
        return (
          <div
            key={o.id}
            className={`overlay-item overlay-${o.kind}${selected ? ' selected' : ''}${editing ? ' editing' : ''}${dragging ? ' dragging' : ''}`}
            data-overlay-id={o.id}
            data-testid={`${o.kind}-overlay`}
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
            onPointerDown={editing ? undefined : (e) => beginDrag(e, o, 'move')}
            onPointerMove={(e) => onMove(e, o)}
            onPointerUp={(e) => endDrag(e, o, true)}
            onPointerCancel={(e) => endDrag(e, o, false)}
            onClick={(e) => {
              if (textMode && o.kind === 'text' && !editing) {
                e.stopPropagation();
                startEditing(o);
              }
            }}
            onDoubleClick={() => {
              if (!editing && o.kind === 'text') startEditing(o);
            }}
          >
            {o.kind === 'image' ? (
              <ImageBox overlay={o} />
            ) : editing ? (
              <TextEditor viewport={viewport} />
            ) : (
              <TextBox overlay={o} widthPt={rect.width / scale} scale={scale} />
            )}
            {selected && editable ? (
              <SelectionHandles onHandleDown={(corner, e) => beginDrag(e, o, corner)} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
