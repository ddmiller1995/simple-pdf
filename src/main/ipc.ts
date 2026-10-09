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

// T3: imports for the signature handlers live next to them (ES imports hoist) so that edits to
// registerFileIpc's imports above do not collide with this block.
import { app } from 'electron';
import { join } from 'node:path';
import { createSignatureStore, type SignatureStore } from './signatureStore';

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
