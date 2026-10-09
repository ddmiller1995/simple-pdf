import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc';
import { writeFileAtomic } from './atomicWrite';
import { createSignatureStore, type SignatureStore } from './signatureStore';

export function registerFileIpc(): void {
  const { invoke } = IPC_CHANNELS;
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
  ipcMain.handle(invoke.savePdfDialog, async (event, suggested: unknown) => {
    // E2E test hook (unpackaged builds only): skip the native dialog and save to this path.
    const hook = app.isPackaged ? undefined : process.env['SIMPLE_PDF_E2E_SAVE'];
    if (hook) return approveWritePath(hook);
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.SaveDialogOptions = {
      title: 'Save PDF',
      defaultPath: typeof suggested === 'string' && suggested ? suggested : 'document-signed.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    };
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    return result.canceled || !result.filePath ? null : approveWritePath(result.filePath);
  });
  ipcMain.handle(invoke.writePdf, async (_event, path: unknown, bytes: unknown) => {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Invalid path');
    // Defense in depth: only write where the user chose to save via the dialog.
    if (!approvedWritePaths.has(path)) throw new Error('Path was not chosen in the save dialog');
    if (!(bytes instanceof Uint8Array) || !isPdfBytes(bytes)) throw new Error('Invalid data');
    await writeFileAtomic(path, bytes);
  });
}

/** Paths the user picked in the save dialog this session; writePdf refuses any other path. */
const approvedWritePaths = new Set<string>();

function approveWritePath(path: string): string {
  approvedWritePaths.add(path);
  return path;
}

function isPdfBytes(bytes: Uint8Array): boolean {
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
  return bytes.byteLength > magic.length && magic.every((b, i) => bytes[i] === b);
}

let signatureStore: SignatureStore | undefined;

/** Lazily created so `app.getPath('userData')` is only read after the app is ready. */
function getSignatureStore(): SignatureStore {
  signatureStore ??= createSignatureStore(join(app.getPath('userData'), 'signatures'));
  return signatureStore;
}

export function registerSignatureIpc(): void {
  const { invoke } = IPC_CHANNELS;
  // The store validates every payload (PNG data URL, <= 5 MB, kind, label, uuid ids).
  ipcMain.handle(invoke.listSignatures, () => getSignatureStore().list());
  ipcMain.handle(invoke.addSignature, (_e, sig: unknown) =>
    getSignatureStore().add(sig as Parameters<SignatureStore['add']>[0]),
  );
  ipcMain.handle(invoke.deleteSignature, (_e, id: unknown) =>
    getSignatureStore().delete(id as string),
  );
}
