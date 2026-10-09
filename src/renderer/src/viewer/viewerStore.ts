import { create } from 'zustand';

/**
 * Transient viewer UI state that is not part of the document contract: the page indicator, the
 * "fit width" request counter, load errors, and a counter that changes on every load so page
 * slots remount for a new document.
 */
type ViewerState = {
  loadId: number;
  currentPage: number; // 0-based
  fitTick: number;
  openError: string | null;
  bumpLoad(): void;
  setCurrentPage(index: number): void;
  requestFit(): void;
  setOpenError(message: string | null): void;
};

export const useViewerStore = create<ViewerState>((set) => ({
  loadId: 0,
  currentPage: 0,
  fitTick: 0,
  openError: null,
  bumpLoad: () => set((s) => ({ loadId: s.loadId + 1, currentPage: 0 })),
  setCurrentPage: (currentPage) => set({ currentPage }),
  requestFit: () => set((s) => ({ fitTick: s.fitTick + 1 })),
  setOpenError: (openError) => set({ openError }),
}));
