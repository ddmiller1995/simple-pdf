import { beforeEach, describe, expect, it } from 'vitest';
import { useDocumentStore, type DocState } from '@renderer/state/documentStore';
import type { TextOverlay } from '@shared/types';

const doc: DocState = {
  fileName: 'a.pdf',
  sourcePath: '/tmp/a.pdf',
  sourceBytes: new Uint8Array([1, 2, 3]),
  pages: [{ index: 0, widthPt: 612, heightPt: 792, rotation: 0 }],
  capabilities: { editable: true, hasAcroForm: false },
};

function text(id: string): TextOverlay {
  return {
    kind: 'text',
    id,
    pageIndex: 0,
    rect: { x: 10, y: 10, width: 100, height: 20 },
    text: 'hello',
    fontSize: 12,
    color: [0, 0, 0],
  };
}

const store = useDocumentStore;

beforeEach(() => {
  store.getState().loadDocument(doc);
});

describe('documentStore', () => {
  it('starts clean after loadDocument', () => {
    const s = store.getState();
    expect(s.doc?.fileName).toBe('a.pdf');
    expect(s.overlays).toEqual([]);
    expect(s.dirty).toBe(false);
    expect(s.history.past).toHaveLength(0);
  });

  it('addOverlay marks dirty and is undoable / redoable', () => {
    store.getState().addOverlay(text('t1'));
    expect(store.getState().overlays).toHaveLength(1);
    expect(store.getState().dirty).toBe(true);

    store.getState().undo();
    expect(store.getState().overlays).toHaveLength(0);
    expect(store.getState().dirty).toBe(false);

    store.getState().redo();
    expect(store.getState().overlays.map((o) => o.id)).toEqual(['t1']);
    expect(store.getState().dirty).toBe(true);
  });

  it('updateOverlay and removeOverlay go through history', () => {
    store.getState().addOverlay(text('t1'));
    store.getState().updateOverlay('t1', { rect: { x: 50, y: 50, width: 100, height: 20 } });
    expect(store.getState().overlays[0].rect.x).toBe(50);
    store.getState().removeOverlay('t1');
    expect(store.getState().overlays).toHaveLength(0);

    store.getState().undo();
    expect(store.getState().overlays[0].rect.x).toBe(50);
    store.getState().undo();
    expect(store.getState().overlays[0].rect.x).toBe(10);
  });

  it('setFormValue is covered by undo/redo', () => {
    store.getState().setFormValue('name', 'Ada');
    store.getState().setFormValue('agree', true);
    expect(store.getState().formValues).toEqual({ name: 'Ada', agree: true });
    store.getState().undo();
    expect(store.getState().formValues).toEqual({ name: 'Ada' });
    store.getState().undo();
    expect(store.getState().formValues).toEqual({});
    store.getState().redo();
    expect(store.getState().formValues).toEqual({ name: 'Ada' });
  });

  it('a new edit clears the redo stack', () => {
    store.getState().addOverlay(text('t1'));
    store.getState().undo();
    store.getState().addOverlay(text('t2'));
    expect(store.getState().history.future).toHaveLength(0);
    store.getState().redo();
    expect(store.getState().overlays.map((o) => o.id)).toEqual(['t2']);
  });

  it('undo/redo on empty history are no-ops', () => {
    store.getState().undo();
    store.getState().redo();
    expect(store.getState().dirty).toBe(false);
  });

  it('markSaved clears dirty; undoing past the saved point makes it dirty again', () => {
    store.getState().addOverlay(text('t1'));
    store.getState().markSaved('/tmp/a-signed.pdf');
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().doc?.outputPath).toBe('/tmp/a-signed.pdf');

    store.getState().undo();
    expect(store.getState().dirty).toBe(true);
    store.getState().redo();
    expect(store.getState().dirty).toBe(false);
  });

  it('removing the selected overlay clears the selection; undo drops stale selection', () => {
    store.getState().addOverlay(text('t1'));
    store.getState().select('t1');
    store.getState().undo();
    expect(store.getState().selectedId).toBeUndefined();

    store.getState().redo();
    store.getState().select('t1');
    store.getState().removeOverlay('t1');
    expect(store.getState().selectedId).toBeUndefined();
  });

  it('loadDocument resets overlays, history and dirty', () => {
    store.getState().addOverlay(text('t1'));
    store.getState().loadDocument({ ...doc, fileName: 'b.pdf' });
    const s = store.getState();
    expect(s.doc?.fileName).toBe('b.pdf');
    expect(s.overlays).toEqual([]);
    expect(s.history.past).toHaveLength(0);
    expect(s.dirty).toBe(false);
  });
});
