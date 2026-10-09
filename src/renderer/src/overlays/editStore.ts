import { create } from 'zustand';
import type { PdfRect, TextOverlay } from '@shared/types';
import { useDocumentStore } from '../state/documentStore';

/**
 * The one text box currently being typed into. The draft lives here, not in the document store,
 * so a whole editing session becomes exactly ONE undo step (and a box that stays empty never
 * reaches the document at all).
 */
export type EditSession = {
  overlay: TextOverlay; // the draft (text and rect change while typing)
  isNew: boolean;
  initialText: string;
  initialRect: PdfRect;
};

type EditStore = {
  session: EditSession | null;
  startNew(overlay: TextOverlay): void;
  startEdit(overlay: TextOverlay): void;
  update(patch: Partial<Pick<TextOverlay, 'text' | 'rect'>>): void;
  /** End the session: add / update / remove the overlay in the document store. */
  commit(): void;
  cancel(): void;
};

const sameRect = (a: PdfRect, b: PdfRect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

export const useEditStore = create<EditStore>()((set, get) => ({
  session: null,

  startNew(overlay) {
    get().commit();
    set({ session: { overlay, isNew: true, initialText: '', initialRect: overlay.rect } });
    useDocumentStore.getState().select(undefined);
  },

  startEdit(overlay) {
    get().commit();
    set({
      session: { overlay, isNew: false, initialText: overlay.text, initialRect: overlay.rect },
    });
    useDocumentStore.getState().select(overlay.id);
  },

  update(patch) {
    const s = get().session;
    if (s) set({ session: { ...s, overlay: { ...s.overlay, ...patch } } });
  },

  commit() {
    const s = get().session;
    if (!s) return;
    set({ session: null });
    const docs = useDocumentStore.getState();
    const { overlay } = s;
    const empty = overlay.text.trim() === '';
    if (s.isNew) {
      if (empty) return;
      docs.addOverlay(overlay);
      docs.select(overlay.id);
    } else if (empty) {
      docs.removeOverlay(overlay.id);
    } else if (overlay.text !== s.initialText || !sameRect(overlay.rect, s.initialRect)) {
      docs.updateOverlay(overlay.id, { text: overlay.text, rect: overlay.rect });
    }
  },

  cancel() {
    set({ session: null });
  },
}));
