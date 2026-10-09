import { create } from 'zustand';

/** Transient save UI state: the "Saved to …" toast, the error banner and an in-flight guard. */
type SaveState = {
  saving: boolean;
  toast: string | null;
  error: string | null;
  setSaving(saving: boolean): void;
  setToast(message: string | null): void;
  setError(message: string | null): void;
};

export const useSaveStore = create<SaveState>((set) => ({
  saving: false,
  toast: null,
  error: null,
  setSaving: (saving) => set({ saving }),
  setToast: (toast) => set({ toast }),
  setError: (error) => set({ error }),
}));
