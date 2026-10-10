# Simple PDF: Implementation Plan

> This is the single coordination document that sub-agents read and update.

---

## 1. Context

We are building **Simple PDF**, an offline desktop app for viewing, filling out and signing PDFs. The repo is currently empty. The goals are a deliberately small feature set and a simple UX:

1. Offline-only desktop app. macOS first; Windows and Linux later from the same codebase.
2. Simple UX with only the basics.
3. View multi-page PDFs.
4. Sign PDFs: import a photo or scan of a signature or initials, extract the ink onto a transparent background, then drag and drop it onto a page.
5. Fill PDFs: click anywhere to type free text, and fill the PDF's built-in form fields.
6. Save the result.

Each phase lists its tasks, the files each task owns and its acceptance criteria, so sub-agents can work in parallel without conflicting.

---

## 2. Key decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | App shell | **Electron** (latest stable) + **React 18/19 + TypeScript** | Same Chromium rendering on every OS (important for canvas-heavy PDF rendering and precise drag/drop), one language everywhere, the most mature desktop ecosystem, and Playwright can drive the real app on macOS for E2E tests. Bundle size (~150MB) is acceptable. |
| D2 | Build tooling | **electron-vite** (dev/build) + **electron-builder** (packaging) + **pnpm** | electron-vite is stable and widely used. Electron Forge's Vite plugin is still marked experimental. electron-builder produces dmg/nsis/AppImage from a single config. |
| D3 | PDF rendering | **pdfjs-dist** (Mozilla PDF.js), pinned at install time | The industry standard. Tolerant of malformed files. Includes an AnnotationLayer that renders AcroForm fields as HTML inputs. |
| D4 | PDF writing | **@cantoo/pdf-lib** + **@pdf-lib/fontkit** | A maintained, drop-in fork of pdf-lib (the original has been unmaintained since 2021). Pure JS. Embeds images and fonts, fills and flattens AcroForms. |
| D5 | Signing | **Visual only**: a transparent PNG stamped into the page content | No certificates or PKCS#7 in v1. |
| D6 | Form fields | **Free-text overlays + AcroForm fields** | XFA forms and encrypted PDFs are detected and shown as "view-only" with a clear message. |
| D7 | Save model | **Flatten into page content, Save As by default** | Output looks identical in every viewer. The first save opens a Save As dialog defaulting to `<name>-signed.pdf`. Later Cmd+S writes to that output file. The opened original is never overwritten silently. |
| D8 | State | **Zustand** store in the renderer | Small, simple, easy to test. |
| D9 | Text font | Bundled **Noto Sans Regular** (OFL), embedded with fontkit | Supports Unicode (the standard Helvetica only supports WinAnsi). The same font file is loaded via `@font-face` on screen, so what you see matches what is saved. |
| D10 | Offline guarantee | All network requests blocked in the main process. PDF.js cmaps, standard fonts and wasm are bundled locally. Strict CSP. | Requirement #1. |
| D11 | Testing | **Vitest** (unit, pure modules) + **Playwright `_electron`** (E2E against the real app) | Agents can verify their own work end-to-end. |

**Out of scope for v1:** cryptographic signatures, page operations (rotate/reorder/delete), editing existing PDF annotations, multiple tabs/documents, printing, search, OCR, password-protected PDFs (view-only at most), HEIC import (users can export as JPEG/PNG), auto-update, telemetry.

---

## 3. Architecture

```
┌──────────────────────── Main process (Node) ─────────────────────────┐
│ index.ts      window lifecycle, open-file events, close guard         │
│ security.ts   block network, deny navigation/window.open, CSP         │
│ menu.ts       native menus + accelerators → send events to renderer   │
│ ipc.ts        file dialogs, read/write files (atomic), signature store│
│ signatureStore.ts  userData/signatures/{id}.png + index.json          │
└───────────────▲──────────────────────────────────────────────────────┘
                │ contextBridge (typed `window.api`, see src/shared/ipc.ts)
┌───────────────┴──────────── Preload ─────────────────────────────────┐
│ preload/index.ts   exposes window.api ONLY; no Node in renderer       │
└───────────────▲──────────────────────────────────────────────────────┘
┌───────────────┴──────────── Renderer (React) ────────────────────────┐
│ state/documentStore.ts   source bytes, pages, overlays, formValues,   │
│                          tool mode, selection, undo/redo, dirty flag  │
│ pdf/loader.ts            PDF.js setup (local worker/cmaps/fonts/wasm) │
│ pdf/coords.ts            screen ⇄ PDF user-space conversion (pure)    │
│ pdf/textLayout.ts        shared text metrics for screen + export      │
│ pdf/export.ts            sourceBytes+overlays+formValues → PDF bytes  │
│ pdf/forms.ts             field discovery, value mapping, XFA detect   │
│ signature/extract.ts     photo → transparent cropped ink PNG (pure)   │
│ viewer/*                 Viewer, PageView (Canvas/Form/Overlay layers)│
│ overlays/*               TextBox, ImageBox, selection handles         │
│ signature/*              SignaturePanel, SignatureImportDialog        │
│ toolbar/Toolbar.tsx                                                  │
└──────────────────────────────────────────────────────────────────────┘
```

**Data flow:** Open → main reads bytes → renderer keeps `sourceBytes` (never mutated) → PDF.js renders → user adds overlays and fills fields (all in store) → Save → `export.ts` builds new bytes with pdf-lib → main writes the file atomically.

### Project layout

```
simple-pdf/
  package.json  pnpm-lock.yaml  electron.vite.config.ts  electron-builder.yml
  tsconfig.json  tsconfig.node.json  tsconfig.web.json  .eslintrc / eslint.config.js  .prettierrc
  docs/IMPLEMENTATION_PLAN.md
  resources/icon.icns  resources/fonts/NotoSans-Regular.ttf
  scripts/make-fixtures.ts            # generates test PDFs + synthetic signature photos
  src/shared/types.ts  src/shared/ipc.ts
  src/main/{index,security,menu,ipc,signatureStore}.ts
  src/preload/index.ts
  src/renderer/index.html  src/renderer/src/{main.tsx,App.tsx,styles.css}
  src/renderer/src/state/documentStore.ts
  src/renderer/src/pdf/{loader,coords,textLayout,export,forms}.ts
  src/renderer/src/viewer/{Viewer,PageView,CanvasLayer,FormLayer,OverlayLayer}.tsx
  src/renderer/src/overlays/{TextBox,ImageBox,SelectionHandles}.tsx
  src/renderer/src/signature/{extract.ts,SignaturePanel.tsx,SignatureImportDialog.tsx}
  src/renderer/src/toolbar/Toolbar.tsx
  tests/fixtures/  tests/unit/  tests/e2e/
```

---

## 4. Shared contracts (defined in Phase 0; changes must be logged in §8)

### 4.1 Coordinate convention (critical)

- Overlays are stored in **PDF user space** (points, origin bottom-left, **unrotated** page), *not* screen pixels. Zoom changes never touch stored data.
- `rect = { x, y, width, height }`, where `(x, y)` is the bottom-left corner in unrotated user space. Rotations of 90/180/270 map axis-aligned rects to axis-aligned rects, so this is always well-defined.
- The screen ⇄ PDF conversion uses PDF.js `viewport.convertToPdfPoint` / `convertToViewportPoint` (these handle the CropBox offset and `/Rotate`). Only `pdf/coords.ts` does coordinate math.
- On export, the overlay content is rotated by the page's `/Rotate` so it appears upright to the viewer, exactly as it did on screen.

### 4.2 Types (`src/shared/types.ts`)

```ts
export type PdfRect = { x: number; y: number; width: number; height: number };

export type TextOverlay = {
  kind: 'text'; id: string; pageIndex: number;
  rect: PdfRect;            // box; text flows from top-left (as seen on screen)
  text: string;             // may contain '\n'
  fontSize: number;         // points, default 12
  color: [number, number, number]; // 0..1 RGB, default black
};

export type ImageOverlay = {
  kind: 'image'; id: string; pageIndex: number;
  rect: PdfRect;            // aspect ratio locked to the image
  signatureId: string;
  pngDataUrl: string;       // self-contained so export never needs IPC
};

export type Overlay = TextOverlay | ImageOverlay;
export type FormValue = string | boolean | string[];   // text | checkbox | choice
export type FormValues = Record<string /* fully-qualified field name */, FormValue>;

export type PageInfo = { index: number; widthPt: number; heightPt: number; rotation: 0|90|180|270 };

export type SavedSignature = { id: string; label: string; kind: 'signature'|'initials'; createdAt: string; pngDataUrl: string };

export type DocCapabilities = { editable: boolean; hasAcroForm: boolean; reason?: 'encrypted'|'xfa'|'unparseable' };
```

### 4.3 IPC API (`src/shared/ipc.ts`, exposed as `window.api`)

```ts
interface Api {
  openPdfDialog(): Promise<{ path: string; bytes: Uint8Array } | null>;
  readPdf(path: string): Promise<Uint8Array>;                  // for drag-drop / open-file
  savePdfDialog(suggestedName: string): Promise<string | null>; // returns chosen path
  writePdf(path: string, bytes: Uint8Array): Promise<void>;     // atomic: tmp + rename
  listSignatures(): Promise<SavedSignature[]>;
  addSignature(sig: Omit<SavedSignature,'id'|'createdAt'>): Promise<SavedSignature>;
  deleteSignature(id: string): Promise<void>;
  setDirty(dirty: boolean): void;                               // main uses this for close guard
  onMenu(cb: (cmd: MenuCommand) => void): () => void;
  onOpenFile(cb: (path: string) => void): () => void;           // Finder "Open With", 2nd-instance
}
type MenuCommand = 'open'|'save'|'saveAs'|'undo'|'redo'|'zoomIn'|'zoomOut'|'zoomFit'|'toolSelect'|'toolText'|'delete';
```

### 4.4 Store shape (`state/documentStore.ts`)

`{ doc: { fileName, sourcePath, outputPath?, sourceBytes, pages: PageInfo[], capabilities } | null, overlays: Overlay[], formValues: FormValues, tool: 'select'|'text', selectedId?: string, zoom: number, history: { past, future }, dirty: boolean }` plus actions: `loadDocument`, `addOverlay`, `updateOverlay`, `removeOverlay`, `setFormValue`, `setTool`, `select`, `undo`, `redo`, `markSaved`. Undo history covers overlays and formValues.

### 4.4b PDF.js document access (`pdf/loader.ts`)

`loadPdf(bytes)` loads a document and makes it the current one. `getPdfDocument()` returns the current `PDFDocumentProxy` (or null) and `getPdfPage(index)` returns a cached `PDFPageProxy`. Layers that need PDF.js objects (CanvasLayer, FormLayer) use these getters. Proxies are never stored in the Zustand store.

### 4.5 PageView composition

`PageView` stacks three absolutely positioned layers of identical size: `CanvasLayer` (PDF.js bitmap) → `FormLayer` (PDF.js AnnotationLayer inputs) → `OverlayLayer` (our text/images). Each layer receives `{ page: PageInfo, viewport: PageViewport }`. Phase 0 creates all three as stubs so their owners can work in parallel.

---

## 5. Agent coordination rules

1. **Read §2–§4 before starting.** Contracts are fixed. If you must change one, make the smallest change, record it in §8 Change Log, and update every stub or consumer in the same commit.
2. **Own only your files.** Each task lists the files it owns. Touching another task's files requires a note in §8.
3. **Work on a branch** `task/<ID>-<slug>` (use a git worktree when tasks run in parallel). Rebase on `main` before merging.
4. **Test-first for pure modules** (`coords`, `textLayout`, `export`, `forms`, `extract`, store).
5. **Definition of done:** `pnpm typecheck && pnpm lint && pnpm test` pass, the task's acceptance criteria are met, any relevant E2E test is added and passing (`pnpm e2e`), and the §7 status table is updated with notes.
6. **No network calls of any kind** in app code or at runtime. Never load fonts, workers or wasm from a CDN.
7. Run all node/pnpm commands with Node 24 (`fnm exec --using=24 -- <cmd>`), e.g. `fnm exec --using=24 -- pnpm test`. The shell default may still be Node 20.
8. Keep the UX minimal. If you feel the urge to add a feature, add a note to §8 instead.
9. **Tests rely only on committed files.** Every fixture a test uses lives in git (generated by `scripts/make-fixtures.ts` or committed directly). Personal files (e.g. `tests/fixtures/real-signature.*`, which is gitignored) may only be used by tests that skip when the file is missing.
10. **Parallel phases:** when several tasks run at the same time, agents do NOT edit this plan file. They put status notes and change-log entries in their final report, and the orchestrator copies them into §7/§8 when merging. Avoid adding dependencies; if one is unavoidable, list it in your report.

### Execution settings (token budget)

The orchestrator spawns each task with an explicit `model` and `effort`. Most tasks run on Sonnet 5.5 at medium effort. Higher effort is used only where a subtle mistake would be expensive to find later.

| Task | Model | Effort | Reason |
|---|---|---|---|
| T0 Scaffold & contracts | Sonnet 5.5 | high | Every later task builds on these definitions. |
| T1 Viewer | Sonnet 5.5 | medium | Well-trodden PDF.js usage. |
| T2 Coords/text/export | Sonnet 5.5 | high | Rotation and coordinate math; subtle off-by-transform bugs. |
| T3 Signature extraction | Sonnet 5.5 | high | Image-processing algorithm. |
| T4 AcroForms | Sonnet 5.5 | medium | |
| T5 Overlay editing | Sonnet 5.5 | medium | |
| T6 Save & lifecycle | Sonnet 5.5 | medium | |
| T7 E2E & polish | Sonnet 5.5 | medium | |
| T8 Packaging | Sonnet 5.5 | medium | |

Token-saving rules:
- The orchestrator (Opus) only dispatches tasks, reviews diffs and merges; it doesn't do implementation work.
- Agents read only §2–§5 plus their own task section, not the whole plan.
- A failing task is resumed with SendMessage (its context is kept) instead of being respawned from scratch.
- If a task fails review twice, escalate it to high effort.

---

## 6. Tasks

### Phase 0: Foundation (1 agent, sequential; blocks everything)

#### T0 · Scaffold, security, contracts, fixtures
- **Owns:** everything at the root, `src/shared/*`, `src/main/{index,security}.ts`, `src/preload/index.ts`, stubs for every file in the §3 layout, `scripts/make-fixtures.ts`, `tests/fixtures/*`, `tests/e2e/smoke.spec.ts`.
- **Steps:**
  1. Scaffold electron-vite with the React + TS template, using pnpm. Add ESLint, Prettier, Vitest and Playwright. Scripts: `dev`, `build`, `typecheck`, `lint`, `test`, `e2e`, `fixtures`, `dist:mac`.
  2. Security: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. `setWindowOpenHandler → deny`. Prevent `will-navigate`. `session.webRequest.onBeforeRequest` cancels `http(s)/ws(s)` (allow only the Vite dev-server origin in dev). CSP meta: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; img-src 'self' data: blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self' blob: data:`.
  3. Write `src/shared/types.ts` and `src/shared/ipc.ts` exactly as in §4. Typed preload bridge. Stub IPC handlers that throw `NotImplemented`.
  4. Zustand store skeleton with the §4.4 shape and unit-tested `undo`/`redo`/`dirty` basics.
  5. Stubs for all renderer components (render placeholders) so later tasks only fill in their own files.
  6. `scripts/make-fixtures.ts` (uses pdf-lib) generates: `simple-3page.pdf` (Letter, labeled pages), `mixed-sizes.pdf` (Letter + A4 + landscape), `rotated.pdf` (pages with /Rotate 0/90/180/270, each with a marker in a known corner), `cropbox-offset.pdf` (CropBox ≠ MediaBox), `acroform.pdf` (text, multiline text, checkbox, radio group, dropdown), `encrypted.pdf` (create with `qpdf` if available; otherwise commit a small public-domain sample and record its source), `large-50page.pdf`. Also synthetic signature photos via canvas/pngjs: dark strokes on (a) clean white, (b) off-white with a lighting gradient plus noise, (c) lined paper, and (d) a blue-ink variant. Add a README in `tests/fixtures/` asking the human to drop in a real phone photo `real-signature.jpg`.
  7. Playwright `_electron` smoke test: the app launches and shows the empty state "Open a PDF or drag one here".
- **Acceptance:** `pnpm dev` opens the window. All scripts pass. The smoke E2E passes. Fixtures are generated and committed. Devtools Network shows zero external requests.

### Phase 1: Core modules (4 agents in parallel after T0)

#### T1 · Viewer
- **Owns:** `pdf/loader.ts`, `viewer/{Viewer,PageView,CanvasLayer}.tsx`, `App.tsx` (empty state + layout), `toolbar/Toolbar.tsx` (zoom + page indicator + Open only), main `ipc.ts` open/read handlers.
- **Steps:** Configure PDF.js with a local worker (Vite `?url` import), `cMapUrl` / `standardFontDataUrl` / `wasmUrl` pointing to assets copied from `pdfjs-dist` into the build output, and `isEvalSupported: false`. Open via the toolbar, File menu and drag-drop onto the window. Render a vertical scroll of pages with a gap. Lazy-render only visible ±1 pages (IntersectionObserver) and release canvases far off-screen. HiDPI: canvas size = CSS size × `devicePixelRatio`. Zoom: fit-width (default), ±, 50–400%, Cmd+= / Cmd+- / Cmd+0. The page indicator "3 / 12" tracks scroll. Populate the store's `pages: PageInfo[]`.
- **Acceptance:** All fixtures render correctly, including `rotated`, `cropbox-offset` and `mixed-sizes`. The 50-page file scrolls smoothly with bounded memory. E2E: open `simple-3page.pdf` → 3 pages visible, indicator works. Opening an unparseable file shows a friendly error.

#### T2 · Coordinates, text layout and export engine (pure, heavily tested)
- **Owns:** `pdf/coords.ts`, `pdf/textLayout.ts`, `pdf/export.ts`, `resources/fonts/*`, `tests/unit/{coords,textLayout,export}.test.ts`.
- **Steps:**
  1. `coords.ts`: `screenRectToPdfRect(viewport, domRect)` and `pdfRectToScreenRect(viewport, rect)` built on PDF.js viewport conversion. Unit-test all four rotations and the CropBox offset (construct real `PageViewport` objects in Node).
  2. `textLayout.ts`: one source of truth for line height (`1.2 × fontSize`), ascent and line breaking from the Noto Sans metrics (fontkit). The screen TextBox uses the same CSS font, size and line height. Export uses these numbers for baselines: line *i* baseline = top − ascent − i × lineHeight, in the rotated "visual" frame.
  3. `export.ts`: `exportPdf({ sourceBytes, overlays, formValues, pages }): Promise<Uint8Array>`. Load with pdf-lib and register fontkit. Embed Noto Sans once (try `subset: true`; fall back to `false` if glyph issues appear). For each overlay, draw on its page. Text uses `drawText` per line with `rotate: degrees(pageRotation)` and an origin transformed into the visual frame. Images use `embedPng` (cache by `signatureId`) and `drawImage` with the same rotation logic. Form values are delegated to `forms.applyFormValues` (T4). Use a no-op until T4 lands, behind the imported function signature.
- **Acceptance:** Round-trip tests re-open the output with PDF.js (Node legacy build). `getTextContent()` finds the overlay text at the expected position (±1pt) and orientation for every rotation and the CropBox fixture. Image XObjects are present at the expected rect. Unicode text (é, ü, ñ, Cyrillic) round-trips. The source bytes are unmodified after export.

#### T3 · Signature extraction and signature library
- **Owns:** `signature/extract.ts`, `signature/SignatureImportDialog.tsx`, `signature/SignaturePanel.tsx` (list/add/delete only; dragging comes in T5), `src/main/signatureStore.ts`, signature IPC handlers in `src/main/ipc.ts` (coordinate the file with T1: add separate `registerSignatureIpc()` / `registerFileIpc()` functions), `tests/unit/extract.test.ts`.
- **Algorithm (`extract.ts`, pure, operates on `{ data: Uint8ClampedArray; width; height }`):**
  1. Decode with `createImageBitmap(file, { imageOrientation: 'from-image' })` (in the dialog, not in the pure module). Downscale so the long edge is at most 2000px.
  2. Convert to luminance (Rec. 709).
  3. **Flat-field the background:** estimate the illumination with a large box blur (radius ≈ 1/16 of the short edge, three-pass separable box ≈ Gaussian), then `norm = clamp(lum / bg)`. This removes shadows and lighting gradients from phone photos.
  4. **Otsu threshold** on `norm`, plus a user `sensitivity` offset (−0.2…+0.2).
  5. **Soft alpha** for anti-aliased edges: alpha ramps linearly over ±0.05 around the threshold.
  6. **Despeckle:** connected components (8-neighbourhood) on the binary mask. Drop components smaller than `max(20px, 0.02% of the area)`. Optionally drop long thin horizontal components spanning >60% of the width (ruled lines) when "Remove lines" is checked.
  7. **Crop** to the bounding box of the remaining ink + 4% padding. Error if no ink is found.
  8. **Recolor:** `black` (#111), `blue` (#1a3d8f) or `original` (keep the source RGB). Output RGBA, encoded to PNG in the dialog via an OffscreenCanvas.
  - Return `{ imageData, bbox, threshold }`. It must run under 300ms on a 2000px image; if it can't, move it to a Web Worker.
- **Dialog UX:** choose file (PNG/JPEG/WebP) or drop it in → side-by-side original and result (on a checkerboard background) → controls: Sensitivity slider, Ink color (Black/Blue/Original), Remove lines checkbox, Type (Signature / Initials) → Save. The result preview updates live (debounced).
- **Store:** `userData/signatures/<uuid>.png` + `index.json`. IPC validates that data URLs are PNG and under 5MB.
- **More committed fixtures:** extend the signature part of `scripts/make-fixtures.ts` with realistic dummy signatures, each with ground truth: cursive-like strokes with variable pen width, a slightly rotated and shadowed "phone photo", a heavily compressed JPEG, and initials. Commit the generated files.
- **Acceptance:** Unit tests on all synthetic fixtures: the background becomes fully transparent (alpha = 0 for >99% of non-ink pixels in a known region), the ink is kept (>95% of known stroke pixels opaque), the crop is tight around the known stroke bbox (±5%), and lined paper with "Remove lines" leaves no line. Manual check with `real-signature.jpg` if provided. Saved signatures persist across restarts.

#### T4 · AcroForm support
- **Owns:** `pdf/forms.ts`, `viewer/FormLayer.tsx`, `tests/unit/forms.test.ts`.
- **Steps:** Keep PDF.js scripting disabled (`enableScripting: false`; never load the quickjs sandbox). `FormLayer` renders the PDF.js `AnnotationLayer` with `renderForms: true` into the layer div, using the document's `annotationStorage`. On input changes, map the annotation id → field name via `pdfDocument.getFieldObjects()` and call `store.setFormValue(name, value)`. On load, `forms.detectCapabilities(pdfjsDoc, bytes)` sets `hasAcroForm`, detects XFA (`pdfjsDoc.allXfaHtml` / `isPureXfa`) and encryption (pdf-lib load with `ignoreEncryption: false` throws) → `editable: false` with a reason. `forms.applyFormValues(pdfLibDoc, formValues)` handles text, checkbox, radio, dropdown and option list, then `form.flatten()` (with `updateFieldAppearances`). Wrap each field in try/catch: a field that fails to flatten is logged and left as a filled field rather than failing the whole save. Undo/redo must update the HTML inputs (re-sync from the store).
- **Acceptance:** Unit test: fill every field type in `acroform.pdf` → export → re-open with PDF.js → there are no remaining form fields, and the text content contains the values. E2E: type into a field → save → reopen → the value is visible. `encrypted.pdf` and an XFA sample show a view-only banner and the editing tools are disabled.

### Phase 2: Editing and lifecycle (2 agents in parallel after Phase 1)

#### T5 · Overlay editing (text tool, signature placement, selection)
- **Depends on:** T1, T2 (`coords`, `textLayout`), T3 (panel).
- **Owns:** `viewer/OverlayLayer.tsx`, `overlays/*`, drag behaviour in `SignaturePanel.tsx`, the tool buttons in `Toolbar.tsx` (coordinate with T1's toolbar regions), store actions as needed.
- **Behaviour:**
  - **Tools:** Select (V) and Text (T). The Sign button opens the signature panel (popover) with saved signatures/initials and "Add signature…" (opens the T3 dialog).
  - **Text tool:** clicking on a page creates a TextBox at the click point with the caret ready. It auto-grows as you type. Enter adds a newline. Esc or a click outside commits. Empty boxes are removed. Font-size control (8–36pt, default 12) appears in the toolbar when a text box is selected. Double-click with the Select tool edits the text.
  - **Signature drag:** pointer-based drag from a panel thumbnail shows a ghost that follows the cursor. Dropping on a page creates an `ImageOverlay` with a default width of 150pt (initials 60pt), aspect locked, centred on the drop point and clamped to the page. Clicking a thumbnail also works: it places the signature at the centre of the visible page.
  - **Selection:** click to select (outline + 4 corner handles). Drag to move, constrained to the page. Corner drag resizes images with the aspect locked; for text, corner drag resizes the box width (text re-wraps). Delete/Backspace removes. Arrow keys nudge 1pt (Shift = 10pt).
  - All edits go through store actions, so undo/redo (Cmd+Z / Cmd+Shift+Z) works. Overlays re-position correctly on zoom (positions are derived from the PDF rect).
- **Acceptance:** E2E: place text on page 2 of `rotated.pdf` (90° page) and a signature on page 1 → zoom in/out → the overlays stay anchored → undo/redo works → save → the T2 round-trip check confirms positions. Manual: interaction feels smooth at 60fps on the 50-page fixture.

#### T6 · Save flow and document lifecycle
- **Depends on:** T1, T2.
- **Owns:** `src/main/menu.ts`, the save/close parts of `src/main/index.ts` and file IPC in `ipc.ts`, `App.tsx` save orchestration, `electron-builder.yml` file associations.
- **Behaviour:**
  - **Save (Cmd+S):** if no `outputPath`, act as Save As. Otherwise export and write to `outputPath`. **Save As (Cmd+Shift+S):** dialog defaulting to `<dir>/<name>-signed.pdf`. If the user picks the original path, the native dialog confirms the replace; that's allowed because it was explicit. Writes are atomic (temp file in the same directory + rename). After a successful save: `markSaved()`, `setDirty(false)`, and a brief "Saved to …" toast. On failure, show an error dialog and keep the dirty state.
  - **Unsaved changes:** a prompt (Save / Don't Save / Cancel) when opening another file, closing the window or quitting (main tracks dirty via `setDirty`). The window title shows `name.pdf — Edited`, and `win.setDocumentEdited` is set on macOS.
  - **Menus:** standard macOS app menu; File (Open…, Save, Save As…, Close); Edit (Undo, Redo, Cut, Copy, Paste, Delete, Select All, using roles where possible); View (Zoom In/Out, Actual Size, Fit Width); Window; Help. All are cross-platform via `process.platform` checks.
  - **Open paths:** `open-file` (macOS Finder / Dock), `second-instance` + argv (Windows/Linux), single-instance lock. `.pdf` file association declared (role: Editor, not default handler).
  - Disable Save when `capabilities.editable` is false.
- **Acceptance:** E2E: edit → Cmd+S → dialog (stubbed in tests via an env-guarded test hook) → the file exists → re-opening shows the edits → the original's bytes are unchanged (hash compare). Closing with unsaved changes prompts. Opening via `open-file` works.

### Phase 3: Integration, polish, packaging (2 agents after Phase 2)

#### T7 · End-to-end flows and UX polish
- **Owns:** `tests/e2e/*` (full flows), `styles.css`, cross-cutting UI polish (coordinate in §8 before editing other owners' components).
- **Steps:** Full-flow E2E: open → fill form fields → add free text → import signature from a synthetic photo → drag it onto the last page → save → verify the output with a PDF.js text and image check. Visual polish: a clean, native-feeling toolbar (system font, macOS-like spacing), clear empty state, view-only banner, keyboard shortcuts listed in the tooltips, light/dark mode via `prefers-color-scheme` (the PDF pages stay white). Accessibility: every toolbar button has a label, there are focus rings, and text boxes are keyboard-reachable. Write `docs/MANUAL_QA.md` (the checklist in §9).
- **User feedback from the first hands-on test (2026-10-09). T7 now also owns the T5 overlay files needed for these:**
  1. **Corner handles scale text.** On a selected text box, dragging a corner scales the text proportionally: font size and box grow or shrink together, keeping the opposite corner anchored. Clamp the font size to 6–96pt. The font-size dropdown shows the current size even when it isn't a preset (show it rounded to 0.5pt). Add a middle handle on the left and right edges that keeps the old behaviour: change the box width and re-wrap. One drag = one undo step. Image (signature) corners are unchanged (aspect-locked resize).
  2. **Place a signature at the cursor ("stamp" mode).** Clicking a signature thumbnail arms it instead of placing it at the page centre. A semi-transparent ghost at its default size follows the cursor over pages. Clicking a page places it centred on the cursor, clamped to the page, and disarms. Shift+click places it and stays armed, for initialling many pages. Esc, clicking the toolbar or choosing another tool cancels. The cursor shows a crosshair while armed. Dragging a thumbnail still works as before. Update the toolbar tooltip / panel hint text to explain this.
  - Cover both with E2E tests: a diagonal corner drag increases `fontSize` and the export round-trip still matches to ±1pt; an armed click places the signature at the cursor to ±1pt (in PDF space) on a rotated page; Shift+click stamps twice; Esc cancels.
- **Acceptance:** All E2E tests are green. The manual QA checklist has been run once and its results recorded in §7.

#### T8 · Packaging (macOS now, Windows/Linux configured)
- **Owns:** `electron-builder.yml`, `resources/icon.*`, `build/entitlements.mac.plist`, `docs/RELEASING.md`.
- **Steps:** mac targets `dmg` + `zip`, arch `universal` (or separate arm64/x64). Hardened runtime entitlements. Ensure the PDF.js worker, cmaps, standard fonts, wasm and Noto Sans are inside the asar/unpacked resources, and verify the packaged app works with Wi-Fi off. Signing and notarization are documented but optional (it needs an Apple Developer ID, $99/yr; without one, users right-click → Open the first time). Configure `win: nsis` and `linux: AppImage, deb` targets. They're not verified in v1, but they should build in CI later.
- **Acceptance:** `pnpm dist:mac` produces a dmg that installs and runs offline. Opening a PDF via Finder "Open With → Simple PDF" works.

### Dependency graph

```
T0 ──┬── T1 ──┬── T5 ──┬── T7
     ├── T2 ──┤        │
     ├── T3 ──┘        ├── T8
     └── T4 ───── T6 ──┘
(T6 needs T1+T2; T5 needs T1+T2+T3; T4's export hook plugs into T2)
```

---

## 7. Status board (agents update this)

| Task | Status | Branch | Agent/Owner | Notes |
|---|---|---|---|---|
| T0 Scaffold & contracts | done | `task/T0-scaffold` | sonnet-5.5 / high | Scaffold, security, contracts, store, stubs, fixtures and smoke E2E done. All checks green. See §8 for deviations and gotchas. |
| T0.1 Node 24 upgrade | done | `task/T0.1-node24` | sonnet-5.5 / medium | Node >=24 enforced; pdfjs-dist 6, vitest 5, eslint 10, TS 6, @types/node 24. All checks green. See §8. |
| T1 Viewer | done | `task/T1-viewer` | sonnet-5.5 / medium | Loader, viewer, Open, drag-drop, zoom, page indicator. 5 E2E tests. Orchestrator visually verified acroform + rotated rendering. |
| T2 Coords/text/export | done | `task/T2-export` | sonnet-5.5 / high | coords, textLayout, export, inspectPdf. Round-trips at ±1pt for rot 0/90/180/270, CropBox, A4. 84 tests. |
| T3 Signature extraction & library | done | `task/T3-signatures`, `task/T3b-remove-lines` | sonnet-5.5 / high | Extraction, store, IPC, dialog, panel. 10 synthetic fixtures at ≥98.6% ink kept / 100% bg removed with Remove lines on. Real photo verified visually (identical with/without Remove lines). |
| T4 AcroForms | done | `task/T4-forms` | sonnet-5.5 / medium | forms.ts + FormLayer merged; unit criteria met. E2E form fill + view-only banner covered by T6's save.spec. |
| T5 Overlay editing | done | `task/T5-overlays` | sonnet-5.5 / medium | Text tool, signature drag/click placement, select/move/resize, font size, undo/redo, shortcuts. 14 unit + 2 E2E tests (export round-trip ±1pt on a 90° page). |
| T6 Save & lifecycle | done | `task/T6-save` | sonnet-5.5 / medium | Save/Save As (atomic), unsaved prompt on close/quit/open-another, menus, open-file, view-only banner. Covers T4's deferred E2E. Orchestrator restricted writePdf to dialog-approved paths. |
| T7 E2E & polish | done | `task/T7-polish` | sonnet-5.5 / medium | Text scaling handles, signature stamp mode, full-flow E2E, light/dark mode, accessibility, `docs/MANUAL_QA.md`. §9 checklist not yet run by a human. Final `dist:mac` + `verify:packaged` pass after merge. |
| T8 Packaging | done | `task/T8-packaging` | sonnet-5.5 / medium | arm64 dmg + zip, unsigned. `.app` 297 MB, `.dmg` 128 MB. `pnpm verify:packaged` passes (renders argv + open-file PDFs, only `file:` requests). |

Statuses: `todo` → `in-progress` → `review` → `done` (or `blocked: <reason>`). In the Agent/Owner column, record the model and effort used (e.g. `sonnet-5.5 / medium`).

---

## 8. Change log and open questions

- _(Record any contract change, cross-ownership edit, or deferred idea here: date, task, what, why.)_
- **2026-10-09 · T0 · Pinned versions (deviation from "latest"). SUPERSEDED by T0.1 below (Node 24).** The environment has Node 20.20, so versions that require Node 22+ were avoided: `pdfjs-dist@5.6.205` (6.x needs Node >=22.13; matters because T2/T4 round-trip tests run PDF.js's legacy build under Node), `vitest@4.1.11` (5.x needs Node 22), `vite@7.3.7` (electron-vite 5 supports vite <=7), `@vitejs/plugin-react@5.2.0`, `typescript@5.9.3`, `eslint@9.39.5`. Others: `electron@44.7.0`, `electron-vite@5.0.0`, `react@19.3.0`, `@cantoo/pdf-lib@2.11.1`, `@pdf-lib/fontkit@1.1.1`, `zustand@5.0.15`, `@playwright/test@1.64.0`. Electron's own `engines` says Node >=22.12 but only its binary is used and it runs fine.
- **2026-10-09 · T0.1 · Node 24 upgrade.** `engines.node >=24` in package.json and `engine-strict=true` in `.npmrc`. Changes: `pdfjs-dist` 5.6.205 → 6.3.289, `vitest` 4.1.11 → 5.0.1, `eslint` 9.39.5 → 10.11.0, `@eslint/js` 9.39.5 → 10.0.1 (latest on npm; there is no 10.11), `typescript` 5.9.3 → 6.0.3, `@types/node` 20.19.43 → 24.13.6, `vite` 7.3.7 → 7.3.6 (7.3.7 was published 2026-10-06, inside the 2-week window). Held back: `vite` stays on 7.x because `electron-vite@5.0.0` (latest stable) only supports vite <=7; `@vitejs/plugin-react` stays 5.2.0 because 6.x needs vite 8; `typescript` stays 6.0.x because `typescript-eslint` 8.70 requires TS <6.1 (7.x unsupported); versions newer than 2026-09-25 skipped (eslint 10.12, vitest 5.0.2/5.0.3).
  - Gotchas: TS 6 removed `baseUrl` use for paths, so `tsconfig.web.json` dropped `baseUrl` and uses `./`-relative `paths`. pdfjs-dist 6 keeps `PageViewport` as a type export, `legacy/build/pdf.mjs` (works under Node 24 vitest), `build/pdf.worker.min.mjs?url`, and the `cmaps/`, `standard_fonts/`, `wasm/` dirs (wasm now also has `quickjs-eval.*`, `qcms_bg.wasm`); verified by a throwaway test, not committed. Always run commands via `fnm exec --using=24 --`.
- **2026-10-09 · T0 · Contract additions (nothing removed or renamed).**
  - `src/shared/ipc.ts`: added `IPC_CHANNELS` (channel-name constants shared by main and preload). `Api` and `MenuCommand` are exactly as in §4.3. T1/T3/T6 must register handlers on these channel names.
  - Store (`state/documentStore.ts`): added `setZoom(zoom)` (zoom had no setter), `markSaved(outputPath?)` (optional path sets `doc.outputPath`), and an internal `savedSnapshot` field. `dirty` is computed by identity against `savedSnapshot`, so undoing back to the saved state clears dirty and undoing past it sets it again. Exported types `Tool`, `DocState`, `Snapshot`. History is capped at 200 entries. There is no keystroke coalescing: T4/T5 should add it if per-keystroke undo is too fine-grained.
  - `viewer/layerProps.ts` exports `LayerProps = { page: PageInfo; viewport: PageViewport }` used by PageView and all three layers (§4.5).
  - `pdf/forms.ts` stubs: `detectCapabilities` returns `{ editable: true, hasAcroForm: false }` and `applyFormValues` is a no-op, so T1/T2 can call them before T4 lands. All other stubs throw `NotImplemented`.
- **2026-10-09 · T0 · Gotchas for later tasks.**
  - `pdfjs-dist@5.6` exports `PageViewport` as a TYPE only (not constructible). T2's coords tests must get a real viewport from `pdfPage.getViewport()` (legacy build, Node), and the T0 `Viewer` stub uses a hand-made object cast to `PageViewport`.
  - No `"type": "module"` in package.json: sandboxed preload scripts must be CommonJS, and electron-vite emits `out/preload/index.js` (CJS) only in that mode. Keep the preload dependency-free (it may only `require('electron')`).
  - Electron 44 has no install script. `package.json` has `"postinstall": "node node_modules/electron/install.js"` to fetch the binary. A fresh `pnpm install` therefore needs network once (allowed).
  - Dev mode (`pnpm dev`) relaxes the CSP via a dev-only Vite plugin (`'unsafe-inline'` scripts for the React Refresh preamble, plus `ws://localhost:*` for HMR). The built app uses the strict CSP from §6 T0 exactly. Verified: in the built app, `fetch`/XHR of local `file://` assets works under the strict CSP, and `https://` requests fail with `ERR_BLOCKED_BY_CLIENT`.
  - Path aliases `@renderer/*` and `@shared/*` work in the renderer, Vitest and tsc. Main and preload use relative imports for shared code.
  - Typecheck is four tsconfigs (`node`, `web`, `test`, `e2e`) because the environments differ (DOM vs Node). Unit tests live in `tests/unit` and can import renderer code. Playwright specs live in `tests/e2e` (DOM lib, for `page.evaluate`).
  - E2E: `pnpm e2e` builds, then runs Playwright. `tests/e2e/launch.ts` exports `launchApp(env?)`, which starts the BUILT app (`electron.launch({ args: [repoRoot] })`, with `ELECTRON_RENDERER_URL` cleared so it loads `out/renderer/index.html`) and returns `{ app, page }`. Reuse it; pass test-hook env vars via `env`.
  - Unit tests load fixtures through `tests/helpers/fixtures.ts` (`loadFixture`, `loadPng`, `loadSigTruth`). The §9 `tests/helpers/inspectPdf.ts` round-trip checker was NOT created in T0 (no owner is named for it); T2 should create it.
- **2026-10-09 · T0 · Fixtures.**
  - `qpdf` is not installed, so `encrypted.pdf` was created with `@cantoo/pdf-lib`'s `encrypt()` (AES-256, empty user password + owner password). PDF.js opens it; `PDFDocument.load` throws `EncryptedPDFError`, which is exactly the detection T4 needs. Nothing was downloaded.
  - Extras beyond the plan: `encrypted-userpw.pdf` (user password `secret`, PDF.js throws `PasswordException`), an option list (`interests`) in `acroform.pdf`, and `sig-truth.json` + `sig-truth-mask.png` (ground truth for T3's tests). Encrypted PDFs are not byte-deterministic across regenerations (random IVs); everything else is.
  - `tests/fixtures/real-signature.jpg` (2.7 MB) was dropped in by the human during T0. It is NOT committed by T0 and no test references it; the human decides whether to commit it.
  - `resources/fonts/NotoSans-Regular.ttf` is not added: T2 owns `resources/fonts/*`. `electron-builder.yml` is a minimal placeholder so `pnpm dist:mac` is a valid command; T8 owns the real config (`dist:mac` was not run in T0).
- **2026-10-09 · T1 · Viewer notes.**
  - pdfjs-dist 6 has no `isEvalSupported` or `enableScripting` `getDocument` options (no eval; scripting is simply never loaded). `PDFDocumentProxy.destroy` is gone; use `doc.loadingTask.destroy()`.
  - PDF.js assets (cmaps, standard_fonts, wasm except quickjs, iccs) are copied to `out/renderer/pdfjs/` by a `pdfjsAssets` plugin in `electron.vite.config.ts` (cross-ownership edit).
  - New transient `viewer/viewerStore.ts` (page indicator, fit request, open error). Helpers: `viewer/openDocument.ts` (`openPdfBytes`, `openWithDialog`, `openPath`), `viewer/useViewerCommands.ts` (open/zoom shortcuts).
  - `store.zoom` is a scale (1 = 100%, clamped 0.5–4). Fit-width runs on load and on `requestFit()`. `Viewer` mounts `PageView` with a real viewport within ±1 page of the visible ones.
  - Toolbar slots: `toolbar-tools` for T5, `toolbar-end` for T6's Save.
  - E2E hook: `SIMPLE_PDF_E2E_OPEN=<path>` makes `openPdfDialog` return that file (ignored when packaged).
  - **For T6:** dropped files only give a bare file name as `sourcePath`. Use Electron `webUtils.getPathForFile(file)` in the preload to get the real path (contract addition to `Api`), so Save As can default to the source directory.
- **2026-10-09 · T4 · Forms notes.**
  - `export.ts` saves with `updateFieldAppearances: false` so unflattened (non-WinAnsi) fields keep their NeedAppearances and aren't regenerated with a WinAnsi font. (The claimed throw didn't reproduce; an integration test in `export.test.ts` covers forms + overlays together.)
  - FormLayer reads field names from the widget annotation's `fieldName`. Typing coalesces to one undo step per field focus.
  - Values with non-WinAnsi characters are not flattened (pdf-lib would turn them into `?`). The field stays filled and unflattened, and `NeedAppearances` is set. A follow-up could use the Noto Sans font from T2 for appearances.
  - XFA and unparseable detection are tested with mocked PDF.js docs (there is no XFA fixture).
  - **For T5:** FormLayer is `pointer-events: none` with `auto` on widgets. OverlayLayer must also pass pointer events through outside overlays (except with the Text tool active), or form inputs won't get clicks.
- **2026-10-09 · T2 · Export notes.**
  - New `pdf/fontSource.ts` (`FONT_FAMILY` = "Noto Sans", `FONT_URL`, `getFontBytes`, `setFontBytes`) and `pdf/fontkitCompat.ts`. The shim works around `@cantoo/pdf-lib` 2.11.1 + `@pdf-lib/fontkit` 1.1.1 failing every `subset: true` embed ("reading 'pos'"); subsetting adds <60 KB instead of 600 KB.
  - Font: Noto Sans Regular (hinted TTF) from notofonts, with `OFL.txt` and `SOURCE.txt` in `resources/fonts/`.
  - `ExportInput.pages` is ignored (geometry comes from the file). Extra helpers in `coords.ts`: `userRectToVisualRect`, `visualPointToUser`, `PageBox`, point converters.
  - `tests/helpers/*` must use relative imports (`tsconfig.e2e.json` includes them without aliases).
  - `inspectPdf(bytes, { scale = 1 })` → `{ numPages, pages, fieldObjects, allText }`. Each page has `rotation, view, width, height, viewport, text[], images[], fields[]`. Text items carry `str, transform, user, screen{x,y}, angleDeg, mirrored, sizePx, widthPx`; images carry `user, screen, corners, upright`. `findText(page, needle)`. `tests/helpers/font.ts`: `useNotoSans()` (beforeAll), `notoSansBytes()`.
  - **For T5 (screen/export parity):** call `await initTextLayout()` at startup. Add `@font-face` using `FONT_URL` / `FONT_FAMILY`. TextBox CSS: `line-height: 1.2; font-kerning: none; font-variant-ligatures: none; padding: 0; white-space: pre`. Render the lines from `layoutText(text, fs, widthPt)`. The rect's top-left is the top-left of line 0, and the baseline is `baselineOffset(fs)` (≈ 0.988·fs) below it. Use only `screenRectToPdfRect` / `pdfRectToScreenRect` for conversions.
- **2026-10-09 · T3 · Signature notes.**
  - devDependency `@napi-rs/canvas@1.0.10` (already in the lockfile via pdfjs-dist), used only for JPEG encode/decode in the fixture script and tests.
  - `ExtractResult` gained `inkBbox` and `sourceSize` (`bbox` is the padded crop). `prepareExtraction` / `applyExtraction` support live preview: 38 ms for a full extraction on 2000×1000, 9 ms to re-apply options.
  - Threshold is Otsu capped at the ink/paper half-coverage level. Despeckle relaxes the size limit for small marks near the signature body (i-dots). Remove lines uses long-horizontal-run + thin-vertical-run detection.
  - `signatureStore.ts` is `createSignatureStore(dir)` (no electron import). IPC creates it lazily at `userData/signatures`.
  - New fixtures: `sig-cursive.png`, `sig-phone.jpg`, `sig-jpeg-heavy.jpg`, `sig-initials.png` + masks + `sig-extra-truth.json`. Helper `tests/helpers/sigFixtures.ts`.
  - **For T5:** `<SignaturePanel onPick?(sig) onAdded?(sig) className? />` (self-contained list/add/delete; also exports `useSignatures()`), `<SignatureImportDialog open onClose onSaved?(sig) />`. Both import `signature.css`. T5 adds drag inside `SignaturePanel.tsx`.
- **2026-10-09 · T3b · Remove lines rewrite.** `removeRuledLines` now estimates the common tilt (up to ~3°) by shearing, accepts a band only if it is thin (≤0.6% of the long edge) with one continuous run covering ≥60% of the source width (gaps ≤3 px), and inside a band removes only pixels whose vertical run is no thicker than the line, so crossing strokes survive. When in doubt, keep the ink. Timing with Remove lines is ~98 ms at 2000px. New fixtures: `sig-flourish.png`, `sig-flourish-lined.png`.
- **2026-10-09 · Orchestrator · E2E isolation.** `SIMPLE_PDF_USER_DATA` (unpackaged only) overrides `userData`. `launchApp` gives each launch a fresh temp profile unless one is passed, so E2E never touches the real signature library. The stale smoke test that expected `listSignatures` to be unimplemented now asserts an empty isolated library. `extract.test.ts`'s real-photo test writes previews when `SIG_PREVIEW_DIR` is set.
- **2026-10-09 · T5 · Overlay notes.**
  - Text editing uses a draft in `overlays/editStore.ts`: one edit session = one undo step, and empty boxes never enter the document. Boxes auto-grow to the page edge, then wrap.
  - On rotated pages a box's visual width isn't `rect.width`, so all drag/resize/fit maths runs in screen space (`overlays/geometry.ts`) and converts through `coords`.
  - `updateOverlay` takes a typed `OverlayPatch`. The app mounts immediately; text overlays wait for the font via `overlays/textReady.ts`.
  - The Text tool covers the whole page while active (so it blocks form-field clicks then); in Select mode the overlay layer passes clicks through. Clicking empty space deselects.
  - Font size is a dropdown (8–36pt).
  - Test hook: `window.__simplePdfTest.exportCurrent()` / `.state()` (`src/renderer/src/testHook.ts`), loaded only when a Playwright init script sets `window.__SIMPLE_PDF_E2E__`.
  - `useEditCommands` handles `undo`/`redo`/`delete`/`toolSelect`/`toolText` from both keydown and `onMenu`, falling back to native `execCommand` inside text fields.
- **2026-10-09 · T6 · Save & lifecycle notes.**
  - `Api` additions: `getPathForFile(file)`, `confirmUnsaved(fileName)` → `'save'|'discard'|'cancel'`, `onSaveRequest(cb)` (main asks the renderer to save before closing). New channels `invoke.confirmUnsaved`, `send.saveResult`, `send.openFileReady`, `event.saveRequest`. `onOpenFile` signals `openFileReady` so paths queued before the renderer was ready are flushed.
  - Cross-ownership edits: `viewer/openDocument.ts` (confirm discard before opening; drops use `getPathForFile`), `App.tsx`, `Toolbar.tsx` (`toolbar-end`), `styles.css` (`.notice-banner`, `.toast`), `smoke.spec.ts`.
  - New files: `main/closeGuard.ts`, `main/atomicWrite.ts`, `renderer/src/save/{saveDocument,useSaveCommands,saveStore,SaveStatus,outputName}`.
  - Test hooks (unpackaged only): `SIMPLE_PDF_E2E_SAVE=<path>`, `SIMPLE_PDF_E2E_UNSAVED=save|discard|cancel` (prompts counted in `globalThis.__simplePdfUnsavedPrompts`).
  - **For T7:** the window title is `name — Edited`. Save failures show a `save-error` banner, not a native dialog. A dirty window vetoes `app.close()`; tests can force-quit with `app.evaluate(({ app }) => app.exit(0))`.
  - **For T8:** `electron-builder.yml` has a `fileAssociations` entry (Editor role, no `LSHandlerRank`). Untested: Help menu, real Finder open-file, Windows/Linux `second-instance` and argv.
- **2026-10-09 · T7 · Polish notes.**
  - Text scaling: corner drags scale font size (6–96pt) and box together, opposite corner anchored. Middle `w`/`e` handles change width only. One drag = one undo step. The dropdown shows non-preset sizes rounded to 0.5pt. `MIN_FONT_SIZE`/`MAX_FONT_SIZE` = 6/96. Helpers `scaleRectFrom`, `scaleTextDrag` in `overlays/geometry.ts`.
  - Stamp mode: `overlays/stampStore.ts`, `overlays/useStampMode.tsx`. Clicking a thumbnail arms it; Esc, a toolbar click or a tool change cancels; Shift+click stays armed. Crosshair cursor and `.stamp-mode` class (existing overlays don't intercept the click). A blue toolbar chip shows while armed.
  - UI: CSS-variable dark mode (pages stay white), 13px system font toolbar, `:focus-visible` rings, an empty state with an "Open PDF…" button, tooltips with platform shortcuts, focusable overlays (Enter edits, Delete removes, arrows nudge) with aria labels.
  - Tests: `tests/e2e/editing.spec.ts`, `tests/e2e/flow.spec.ts` (drives the real import dialog with `sig-phone.jpg`).
  - Cross-ownership edits: `OverlayLayer`, `SelectionHandles`, `Toolbar`, `App`, `editActions`, overlay/signature CSS.
  - Known rough edges (deferred): a disabled Select button still looks pressed; the stamp ghost isn't clamped to the page; `placeSignatureOnVisiblePage` is now unused.
- **2026-10-09 · T8 · Packaging notes.**
  - `electron-builder.yml` excludes `node_modules` (Vite bundles every dependency), which shrank the `.app` from 395 MB to 297 MB. The asar contains the PDF.js worker, cmaps, standard fonts, jbig2/openjpeg/qcms wasm and Noto Sans.
  - Entitlements: `allow-jit` only (no network-client). `hardenedRuntime: true`, `identity: null` (unsigned). The `.pdf` file association is kept. `win` (nsis) and `linux` (AppImage, deb) are configured but untested, as is x64.
  - Icon: `build/icon.svg` → `icon.png` / `icon.icns` via `scripts/make-icon.ts` (`pnpm icon`).
  - `pnpm verify:packaged` (`tests/packaged/`, `playwright.packaged.config.ts`) needs `pnpm dist:mac` first. The packaged app ignores the `SIMPLE_PDF_E2E_*` hooks, so drive it with an argv PDF path or `app.emit('open-file', …)`, and use `process.getBuiltinModule` inside `app.evaluate`. Its request recorder replaces the app's own `onBeforeRequest` block for that run; the app's own blocking is covered by `smoke.spec.ts`.
  - **Human decisions pending:** `appId` is the placeholder `com.simplepdf.app`. Signing/notarization needs an Apple Developer ID (steps in `docs/RELEASING.md`).
- **2026-10-09 · Orchestrator · Phase 2 merge fixes.**
  - `writePdf` only accepts paths returned by the save dialog (or its E2E hook) this session, and only bytes starting with `%PDF-`. There's an E2E test for the refusal.
  - `launchApp` now defaults `SIMPLE_PDF_E2E_UNSAVED=discard`. Without it, tests that closed a dirty window popped up a real native "save changes?" dialog that hung each test for a minute (reported by the human). **Rule: E2E must never show a native dialog.** Specs that exercise a prompt pass their own answer.
- **2026-10-09 · Orchestrator · Integration fix.** CanvasLayer now uses `AnnotationMode.ENABLE` for view-only docs or docs without fields (FormLayer renders nothing then, so the bitmap must paint the fields), and `ENABLE_FORMS` otherwise. `.claude/` (agent worktrees) is excluded from ESLint and git.
- **2026-10-09 · Note.** `rotated.pdf`'s label "Upright text reads normally in the rotated view" is misleading: the content is drawn unrotated, so it appears sideways on /Rotate pages (which is the correct rendering). Fix the wording next time `make-fixtures.ts` is touched outside the signature section.
- Deferred ideas: draw a signature with the trackpad (`signature_pad`), "insert today's date" button, checkmark stamp, page thumbnails sidebar, print, find-in-document, HEIC import.

---

## 9. Verification

**Automated (every task, before merge):**
- `pnpm typecheck && pnpm lint && pnpm test` covers unit tests for coords (all rotations and CropBox), textLayout, export round-trips, forms flatten, signature extraction on synthetic photos, and store undo/redo.
- `pnpm e2e` runs Playwright `_electron` against the built app: smoke, open/render, form fill, text placement, signature import + drag, save + re-open, unsaved-changes prompt.

**Round-trip checker (shared test helper `tests/helpers/inspectPdf.ts`):** loads the output with PDF.js in Node. It returns per-page text items with positions, the image XObject count and bounds, and the remaining form fields. Used by T2, T4, T5, T6 and T7.

**Manual QA (`docs/MANUAL_QA.md`, run before calling v1 done):**
1. Turn Wi-Fi off. Launch the packaged app.
2. Open a real-world multi-page PDF (a lease or tax form): it scrolls and zooms, and pages look crisp on Retina.
3. Fill the AcroForm fields, add free text on two pages, and import a real phone photo of a signature. The background is removed cleanly; adjust the sensitivity if needed.
4. Drag the signature and initials onto pages, then resize, move, delete and undo.
5. Save As → open the output in **macOS Preview, Chrome and Adobe Reader**. Everything appears in the same place, nothing is editable or movable, and the text is selectable.
6. Confirm the original file is unchanged. Confirm the close-with-unsaved-changes prompt.
7. Open `encrypted.pdf` → view-only banner, and Save is disabled.

---

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| pdf-lib fails on some malformed PDFs that PDF.js can render | Try the pdf-lib load at open time. On failure, set `editable: false, reason: 'unparseable'` and show the banner, so users can still view the file. |
| Text position drifts between screen and output | A single `textLayout.ts` and the same font file on both sides. Round-trip position tests at ±1pt for all rotations. |
| Phone photos with shadows, lined paper or colored paper | Flat-field normalization, a sensitivity slider and the "Remove lines" option. A trackpad-drawn signature is a deferred fallback. |
| AcroForm flatten breaks on unusual fields | Per-field try/catch with fallback to an unflattened (but filled) field. Tested against the fixture plus a couple of real government forms in manual QA. |
| PDF.js silently fetching resources (cmaps/fonts) | All URLs point at bundled local assets, the network is blocked in main, and an offline packaged-app check is part of T8. |
| Large PDFs exhaust memory | Lazy render visible ±1 pages and release off-screen canvases. Tested with the 50-page fixture. |
| Library API drift (pdfjs-dist is on v5/v6 in 2026) | Pin exact versions in T0. Agents check the installed version's types and docs (context7) rather than relying on memory. |
