import { create } from 'zustand';
import type { SavedSignature } from '@shared/types';
import { useDocumentStore } from '../state/documentStore';

/**
 * "Stamp" mode: a signature armed by clicking its thumbnail. While armed, a ghost follows the
 * cursor and a click on a page places the signature centred on that point.
 */
type StampStore = {
  armed: SavedSignature | null;
  arm(sig: SavedSignature): void;
  disarm(): void;
};

export const useStampStore = create<StampStore>()((set) => ({
  armed: null,
  arm(sig) {
    // Stamping needs the Select tool (the Text tool would capture the click). Switch first so
    // the tool-change subscription below does not immediately disarm.
    useDocumentStore.getState().setTool('select');
    set({ armed: sig });
  },
  disarm() {
    set({ armed: null });
  },
}));

// Choosing another tool, or loading another document, cancels stamp mode.
useDocumentStore.subscribe((s, prev) => {
  if (s.tool !== prev.tool || s.doc !== prev.doc) useStampStore.getState().disarm();
});
