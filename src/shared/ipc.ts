// IPC contract (IMPLEMENTATION_PLAN.md §4.3), exposed to the renderer as `window.api`.
import type { SavedSignature } from './types';

export type MenuCommand =
  | 'open'
  | 'save'
  | 'saveAs'
  | 'undo'
  | 'redo'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomFit'
  | 'toolSelect'
  | 'toolText'
  | 'delete';

export interface Api {
  openPdfDialog(): Promise<{ path: string; bytes: Uint8Array } | null>;
  readPdf(path: string): Promise<Uint8Array>; // for drag-drop / open-file
  savePdfDialog(suggestedName: string): Promise<string | null>; // returns chosen path
  writePdf(path: string, bytes: Uint8Array): Promise<void>; // atomic: tmp + rename
  listSignatures(): Promise<SavedSignature[]>;
  addSignature(sig: Omit<SavedSignature, 'id' | 'createdAt'>): Promise<SavedSignature>;
  deleteSignature(id: string): Promise<void>;
  setDirty(dirty: boolean): void; // main uses this for close guard
  onMenu(cb: (cmd: MenuCommand) => void): () => void;
  onOpenFile(cb: (path: string) => void): () => void; // Finder "Open With", 2nd-instance
  // T6 additions:
  /** Real filesystem path of a dropped File (sandboxed renderers cannot read `file.path`). */
  getPathForFile(file: File): string;
  /** Native Save / Don't Save / Cancel prompt (open-another-file). */
  confirmUnsaved(fileName: string): Promise<UnsavedChoice>;
  /**
   * Main asks the renderer to save before closing/quitting. The callback resolves true only when
   * the file was written; false (cancelled dialog or failure) aborts the close.
   */
  onSaveRequest(cb: () => Promise<boolean>): () => void;
}

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

/**
 * Channel names shared by main and preload so they cannot drift apart.
 * `invoke` channels are request/response; `send` is fire-and-forget renderer -> main;
 * `event` channels are main -> renderer pushes.
 */
export const IPC_CHANNELS = {
  invoke: {
    openPdfDialog: 'pdf:openDialog',
    readPdf: 'pdf:read',
    savePdfDialog: 'pdf:saveDialog',
    writePdf: 'pdf:write',
    listSignatures: 'signatures:list',
    addSignature: 'signatures:add',
    deleteSignature: 'signatures:delete',
    confirmUnsaved: 'doc:confirmUnsaved',
  },
  send: {
    setDirty: 'doc:setDirty',
    saveResult: 'doc:saveResult', // (requestId, ok): answer to event.saveRequest
    openFileReady: 'app:openFileReady', // renderer subscribed to event.openFile; flush queue
  },
  event: {
    menu: 'menu:command',
    openFile: 'app:openFile',
    saveRequest: 'doc:saveRequest', // (requestId)
  },
} as const;
