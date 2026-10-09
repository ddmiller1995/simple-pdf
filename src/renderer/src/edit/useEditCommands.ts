import { useEffect } from 'react';
import { useDocumentStore } from '../state/documentStore';
import { useEditStore } from '../overlays/editStore';
import { deleteSelected, doRedo, doUndo, nudgeSelected } from './editActions';

/** True when a keystroke belongs to a native text control (typing must not edit the document). */
function inTextEntry(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

const editable = (): boolean => useDocumentStore.getState().doc?.capabilities.editable === true;

/**
 * Edit shortcuts (the renderer keydown is the single source of truth, so Playwright can test
 * them) and the matching native-menu commands: undo, redo, delete, toolSelect, toolText.
 * While focus is in an input / textarea / contenteditable the native behaviour wins.
 */
export function useEditCommands(): void {
  useEffect(() => {
    const store = useDocumentStore;

    const offMenu = window.api.onMenu((cmd) => {
      const typing = inTextEntry(document.activeElement);
      if (cmd === 'undo') {
        if (typing) document.execCommand('undo');
        else doUndo();
      } else if (cmd === 'redo') {
        if (typing) document.execCommand('redo');
        else doRedo();
      } else if (cmd === 'delete') {
        if (typing) document.execCommand('delete');
        else deleteSelected();
      } else if (cmd === 'toolSelect' && editable()) {
        store.getState().setTool('select');
      } else if (cmd === 'toolText' && editable()) {
        store.getState().setTool('text');
      }
    });

    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || inTextEntry(e.target)) return;
      if ((e.target as HTMLElement | null)?.closest?.('[role="dialog"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && !e.altKey) {
        if (key === 'z') {
          if (e.shiftKey) doRedo();
          else doUndo();
        } else if (key === 'y' && e.ctrlKey) doRedo();
        else return;
        e.preventDefault();
        return;
      }
      if (mod || e.altKey) return;

      const { selectedId } = store.getState();
      if (key === 'delete' || key === 'backspace') {
        if (!selectedId) return;
        deleteSelected();
      } else if (key === 'v' && !e.shiftKey) {
        if (!editable()) return;
        store.getState().setTool('select');
      } else if (key === 't' && !e.shiftKey) {
        if (!editable()) return;
        store.getState().setTool('text');
      } else if (key === 'escape') {
        if (!selectedId) return;
        store.getState().select(undefined);
      } else if (key.startsWith('arrow')) {
        if (!selectedId) return;
        const step = e.shiftKey ? 10 : 1;
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
        void nudgeSelected(dx, dy);
      } else return;
      e.preventDefault();
    };

    // Clicking anywhere that is not an overlay or toolbar chrome clears the selection.
    const onPointerDown = (e: PointerEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[data-overlay-id], .toolbar, .sig-popover, [role="dialog"]')) return;
      if (store.getState().selectedId) store.getState().select(undefined);
    };

    // Loading another document discards any half-typed box.
    const offDoc = store.subscribe((s, prev) => {
      if (s.doc !== prev.doc) useEditStore.getState().cancel();
    });

    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      offMenu();
      offDoc();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, []);
}
