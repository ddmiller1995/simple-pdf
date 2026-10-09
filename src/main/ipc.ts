import { readFile } from 'node:fs/promises';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc';

// T0 stubs. Owners: T1/T6 fill `registerFileIpc`, T3 fills `registerSignatureIpc`.
// Every handler throws until its owning task implements it.

function notImplemented(name: string): () => never {
  return () => {
    throw new Error(`NotImplemented: ${name}`);
  };
}

export function registerFileIpc(): void {
  const { invoke, send } = IPC_CHANNELS;
  ipcMain.handle(invoke.openPdfDialog, async (event) => {
    // E2E test hook (unpackaged builds only): skip the native dialog and open this file instead.
    const hook = app.isPackaged ? undefined : process.env['SIMPLE_PDF_E2E_OPEN'];
    let path: string | undefined = hook || undefined;
    if (!path) {
      const win = BrowserWindow.fromWebContents(event.sender);
      const options: Electron.OpenDialogOptions = {
        title: 'Open PDF',
        properties: ['openFile'],
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      };
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      path = result.canceled ? undefined : result.filePaths[0];
    }
    if (!path) return null;
    return { path, bytes: new Uint8Array(await readFile(path)) };
  });
  ipcMain.handle(invoke.readPdf, async (_event, path: unknown) => {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path');
    return new Uint8Array(await readFile(path));
  });
  ipcMain.handle(invoke.savePdfDialog, notImplemented('savePdfDialog'));
  ipcMain.handle(invoke.writePdf, notImplemented('writePdf'));
  // setDirty is fire-and-forget; T6 stores the flag for the close guard.
  ipcMain.on(send.setDirty, () => {});
}

export function registerSignatureIpc(): void {
  const { invoke } = IPC_CHANNELS;
  ipcMain.handle(invoke.listSignatures, notImplemented('listSignatures'));
  ipcMain.handle(invoke.addSignature, notImplemented('addSignature'));
  ipcMain.handle(invoke.deleteSignature, notImplemented('deleteSignature'));
}
