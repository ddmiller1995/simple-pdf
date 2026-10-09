import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC_CHANNELS, type Api, type MenuCommand } from '../shared/ipc';

const { invoke, send, event } = IPC_CHANNELS;

/** Subscribe to a main -> renderer event; returns an unsubscribe function. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: Api = {
  openPdfDialog: () => ipcRenderer.invoke(invoke.openPdfDialog),
  readPdf: (path) => ipcRenderer.invoke(invoke.readPdf, path),
  savePdfDialog: (suggestedName) => ipcRenderer.invoke(invoke.savePdfDialog, suggestedName),
  writePdf: (path, bytes) => ipcRenderer.invoke(invoke.writePdf, path, bytes),
  listSignatures: () => ipcRenderer.invoke(invoke.listSignatures),
  addSignature: (sig) => ipcRenderer.invoke(invoke.addSignature, sig),
  deleteSignature: (id) => ipcRenderer.invoke(invoke.deleteSignature, id),
  setDirty: (dirty) => ipcRenderer.send(send.setDirty, dirty),
  onMenu: (cb) => subscribe<MenuCommand>(event.menu, cb),
  onOpenFile: (cb) => {
    const off = subscribe<string>(event.openFile, cb);
    ipcRenderer.send(send.openFileReady); // main flushes paths queued before the renderer was ready
    return off;
  },
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  confirmUnsaved: (fileName) => ipcRenderer.invoke(invoke.confirmUnsaved, fileName),
  onSaveRequest: (cb) =>
    subscribe<number>(event.saveRequest, (requestId) => {
      void cb()
        .catch(() => false)
        .then((ok) => ipcRenderer.send(send.saveResult, requestId, ok));
    }),
};

contextBridge.exposeInMainWorld('api', api);
