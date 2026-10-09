import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';
import { IPC_CHANNELS, type UnsavedChoice } from '../shared/ipc';

// Tracks per-window dirty state (reported by the renderer through `setDirty`) and guards window
// close / quit with a Save / Don't Save / Cancel prompt.

const dirtyWindows = new Set<number>(); // webContents ids
const forceClose = new WeakSet<BrowserWindow>();
const prompting = new WeakSet<BrowserWindow>();
let quitting = false;

let nextRequestId = 1;
const pendingSaves = new Map<number, (ok: boolean) => void>();

function setDirty(wc: WebContents, dirty: boolean): void {
  if (dirty) dirtyWindows.add(wc.id);
  else dirtyWindows.delete(wc.id);
  BrowserWindow.fromWebContents(wc)?.setDocumentEdited(dirty);
}

const isDirty = (win: BrowserWindow): boolean => dirtyWindows.has(win.webContents.id);

/** E2E hook (unpackaged only): `SIMPLE_PDF_E2E_UNSAVED=save|discard|cancel` answers the prompt. */
function hookedChoice(): UnsavedChoice | undefined {
  if (app.isPackaged) return undefined;
  const v = process.env['SIMPLE_PDF_E2E_UNSAVED'];
  if (v !== 'save' && v !== 'discard' && v !== 'cancel') return undefined;
  const g = globalThis as { __simplePdfUnsavedPrompts?: number };
  g.__simplePdfUnsavedPrompts = (g.__simplePdfUnsavedPrompts ?? 0) + 1;
  return v;
}

async function askUnsaved(win: BrowserWindow | null, name: string): Promise<UnsavedChoice> {
  const hooked = hookedChoice();
  if (hooked) return hooked;
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    message: `Do you want to save the changes to "${name}"?`,
    detail: "Your changes will be lost if you don't save them.",
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
  };
  const { response } = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  return response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel';
}

/** Ask the renderer to save; resolves true only when the file was written. */
function requestSave(win: BrowserWindow): Promise<boolean> {
  return new Promise((resolve) => {
    const id = nextRequestId++;
    pendingSaves.set(id, resolve);
    win.webContents.send(IPC_CHANNELS.event.saveRequest, id);
  });
}

function windowName(win: BrowserWindow): string {
  return win.getTitle().replace(/ — Edited$/, '') || 'this document';
}

export function installCloseGuard(win: BrowserWindow): void {
  win.on('close', (e) => {
    if (forceClose.has(win) || !isDirty(win)) return;
    e.preventDefault();
    if (prompting.has(win)) return;
    prompting.add(win);
    void (async () => {
      try {
        const choice = await askUnsaved(win, windowName(win));
        const proceed = choice === 'discard' || (choice === 'save' && (await requestSave(win)));
        if (!proceed) {
          quitting = false;
          return;
        }
        forceClose.add(win);
        win.close();
        if (quitting) app.quit();
      } finally {
        prompting.delete(win);
      }
    })();
  });
  win.on('closed', () => {
    for (const [id, resolve] of pendingSaves) {
      resolve(false);
      pendingSaves.delete(id);
    }
  });
}

export function registerCloseGuardIpc(): void {
  const { send, invoke } = IPC_CHANNELS;
  ipcMain.on(send.setDirty, (event, dirty: unknown) => setDirty(event.sender, dirty === true));
  ipcMain.on(send.saveResult, (_event, id: unknown, ok: unknown) => {
    if (typeof id !== 'number') return;
    pendingSaves.get(id)?.(ok === true);
    pendingSaves.delete(id);
  });
  ipcMain.handle(invoke.confirmUnsaved, (event, name: unknown) =>
    askUnsaved(
      BrowserWindow.fromWebContents(event.sender),
      typeof name === 'string' && name ? name : 'this document',
    ),
  );
  app.on('before-quit', () => {
    quitting = true;
  });
}
