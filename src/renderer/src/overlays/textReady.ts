import { useSyncExternalStore } from 'react';

// The app mounts immediately (drop handlers etc. must be live at DOMContentLoaded); text boxes
// wait until the bundled font is loaded and the layout engine is initialised.
let ready = false;
const listeners = new Set<() => void>();

export function markTextReady(): void {
  ready = true;
  listeners.forEach((l) => l());
}

export function isTextReady(): boolean {
  return ready;
}

export function useTextReady(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => ready,
  );
}
