import { ipcMain } from 'electron';
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
  ipcMain.handle(invoke.openPdfDialog, notImplemented('openPdfDialog'));
  ipcMain.handle(invoke.readPdf, notImplemented('readPdf'));
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
