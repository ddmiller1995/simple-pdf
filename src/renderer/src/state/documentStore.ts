import { create } from 'zustand';
import type { DocCapabilities, FormValue, FormValues, Overlay, PageInfo } from '@shared/types';

export type Tool = 'select' | 'text';

export type DocState = {
  fileName: string;
  sourcePath: string;
  outputPath?: string;
  sourceBytes: Uint8Array; // never mutated
  pages: PageInfo[];
  capabilities: DocCapabilities;
};

/** The part of the state covered by undo/redo. */
export type Snapshot = { overlays: Overlay[]; formValues: FormValues };

export const MAX_HISTORY = 200;

export type DocumentStore = {
  doc: DocState | null;
  overlays: Overlay[];
  formValues: FormValues;
  tool: Tool;
  selectedId?: string;
  zoom: number;
  history: { past: Snapshot[]; future: Snapshot[] };
  dirty: boolean;
  /**
   * Snapshot at the last load/save. `dirty` is true iff the current overlays/formValues differ
   * (by identity) from this. Because undo restores earlier object references, undoing back to the
   * saved state clears the dirty flag.
   */
  savedSnapshot: Snapshot;

  loadDocument(doc: DocState): void;
  addOverlay(overlay: Overlay): void;
  updateOverlay(id: string, patch: Partial<Omit<Overlay, 'id' | 'kind'>>): void;
  removeOverlay(id: string): void;
  setFormValue(name: string, value: FormValue): void;
  setTool(tool: Tool): void;
  select(id?: string): void;
  setZoom(zoom: number): void;
  undo(): void;
  redo(): void;
  markSaved(outputPath?: string): void;
};

const EMPTY: Snapshot = { overlays: [], formValues: {} };

function isDirty(current: Snapshot, saved: Snapshot): boolean {
  return current.overlays !== saved.overlays || current.formValues !== saved.formValues;
}

export const useDocumentStore = create<DocumentStore>()((set, get) => {
  /** Apply an edit to overlays/formValues, recording the previous state for undo. */
  const commit = (next: Partial<Snapshot>): void => {
    const s = get();
    const prev: Snapshot = { overlays: s.overlays, formValues: s.formValues };
    const current: Snapshot = {
      overlays: next.overlays ?? s.overlays,
      formValues: next.formValues ?? s.formValues,
    };
    set({
      ...current,
      history: { past: [...s.history.past, prev].slice(-MAX_HISTORY), future: [] },
      dirty: isDirty(current, s.savedSnapshot),
    });
  };

  const restore = (snap: Snapshot, history: DocumentStore['history']): void => {
    const s = get();
    const selectedStillExists = s.selectedId && snap.overlays.some((o) => o.id === s.selectedId);
    set({
      ...snap,
      history,
      dirty: isDirty(snap, s.savedSnapshot),
      selectedId: selectedStillExists ? s.selectedId : undefined,
    });
  };

  return {
    doc: null,
    overlays: EMPTY.overlays,
    formValues: EMPTY.formValues,
    tool: 'select',
    selectedId: undefined,
    zoom: 1,
    history: { past: [], future: [] },
    dirty: false,
    savedSnapshot: EMPTY,

    loadDocument(doc) {
      const fresh: Snapshot = { overlays: [], formValues: {} };
      set({
        doc,
        ...fresh,
        savedSnapshot: fresh,
        tool: 'select',
        selectedId: undefined,
        history: { past: [], future: [] },
        dirty: false,
      });
    },

    addOverlay(overlay) {
      commit({ overlays: [...get().overlays, overlay] });
    },

    updateOverlay(id, patch) {
      const overlays = get().overlays;
      if (!overlays.some((o) => o.id === id)) return;
      commit({
        overlays: overlays.map((o) => (o.id === id ? ({ ...o, ...patch } as Overlay) : o)),
      });
    },

    removeOverlay(id) {
      const s = get();
      if (!s.overlays.some((o) => o.id === id)) return;
      commit({ overlays: s.overlays.filter((o) => o.id !== id) });
      if (s.selectedId === id) set({ selectedId: undefined });
    },

    setFormValue(name, value) {
      commit({ formValues: { ...get().formValues, [name]: value } });
    },

    setTool(tool) {
      set({ tool });
    },

    select(id) {
      set({ selectedId: id });
    },

    setZoom(zoom) {
      set({ zoom });
    },

    undo() {
      const { history, overlays, formValues } = get();
      const previous = history.past[history.past.length - 1];
      if (!previous) return;
      restore(previous, {
        past: history.past.slice(0, -1),
        future: [{ overlays, formValues }, ...history.future],
      });
    },

    redo() {
      const { history, overlays, formValues } = get();
      const [next, ...rest] = history.future;
      if (!next) return;
      restore(next, {
        past: [...history.past, { overlays, formValues }],
        future: rest,
      });
    },

    markSaved(outputPath) {
      const s = get();
      set({
        savedSnapshot: { overlays: s.overlays, formValues: s.formValues },
        dirty: false,
        doc: s.doc && outputPath ? { ...s.doc, outputPath } : s.doc,
      });
    },
  };
});
