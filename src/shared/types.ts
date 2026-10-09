// Shared contracts (IMPLEMENTATION_PLAN.md §4.2). Changes must be logged in §8.

/**
 * Rectangle in PDF user space (points). Origin is the bottom-left of the UNROTATED page;
 * `(x, y)` is the rect's bottom-left corner.
 */
export type PdfRect = { x: number; y: number; width: number; height: number };

export type TextOverlay = {
  kind: 'text';
  id: string;
  pageIndex: number;
  rect: PdfRect; // box; text flows from top-left (as seen on screen)
  text: string; // may contain '\n'
  fontSize: number; // points, default 12
  color: [number, number, number]; // 0..1 RGB, default black
};

export type ImageOverlay = {
  kind: 'image';
  id: string;
  pageIndex: number;
  rect: PdfRect; // aspect ratio locked to the image
  signatureId: string;
  pngDataUrl: string; // self-contained so export never needs IPC
};

export type Overlay = TextOverlay | ImageOverlay;
export type FormValue = string | boolean | string[]; // text | checkbox | choice
export type FormValues = Record<string /* fully-qualified field name */, FormValue>;

export type PageInfo = {
  index: number;
  widthPt: number;
  heightPt: number;
  rotation: 0 | 90 | 180 | 270;
};

export type SavedSignature = {
  id: string;
  label: string;
  kind: 'signature' | 'initials';
  createdAt: string;
  pngDataUrl: string;
};

export type DocCapabilities = {
  editable: boolean;
  hasAcroForm: boolean;
  reason?: 'encrypted' | 'xfa' | 'unparseable';
};
