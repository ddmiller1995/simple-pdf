# Simple PDF

A small, offline desktop app for the PDF chores that come up most: **view** a PDF, **fill it out**, **sign it**, and **save** a copy.

- **View** multi-page PDFs with zoom and smooth scrolling.
- **Fill** the PDF's own form fields (text boxes, checkboxes, radio buttons, dropdowns), or click anywhere to add free text.
- **Sign** with a photo of your real signature or initials. The paper background is removed automatically. Drag it onto the page, or click it and stamp it where you want (Shift-click to stamp several pages).
- **Save** a new file (`<name>-signed.pdf`). Your text and signatures are baked into the page, so they look the same in every PDF viewer. The original file is never overwritten unless you choose to.
- **Fully offline.** The app never connects to the internet. Your documents and signatures stay on your computer.

Currently built for **macOS on Apple Silicon** (M1 and later). Windows and Linux builds are configured but not yet tested.

## Installing

### Option 1: Download a release (easiest)

1. Go to [Releases](https://github.com/ddmiller1995/simple-pdf/releases) and download the latest `Simple PDF-<version>-arm64.dmg`.
2. Open the `.dmg` and drag **Simple PDF** into **Applications**.
3. Open Simple PDF from Applications. macOS shows a warning that it **could not verify** the app. This is expected: the app isn't registered with Apple (that costs $99/year). Click **Done**.
4. Open **System Settings → Privacy & Security**, scroll down to the message about Simple PDF, and click **Open Anyway**. Confirm with your password or Touch ID.

You only have to do this once. After that, Simple PDF opens like any other app.

<details>
<summary>Prefer Terminal? Skip steps 3 and 4 with one command</summary>

```sh
xattr -dr com.apple.quarantine "/Applications/Simple PDF.app"
```

This removes the "downloaded from the internet" flag, so macOS opens the app without the warning.
</details>

> **Why the warning?** Apps distributed outside the App Store are normally signed with a paid Apple Developer ID and checked by Apple ("notarized"). Simple PDF is a free personal project, so it skips that step. The app is open source: you can read every line here, or build it yourself (Option 2).

### Option 2: Build it yourself

A Mac you build the app on never shows the Gatekeeper warning. You need:

- [Node.js 24](https://nodejs.org/) (if you use [fnm](https://github.com/Schniz/fnm) or nvm, the repo's `.node-version` selects it automatically)
- [pnpm](https://pnpm.io/installation) (`npm install -g pnpm`, or `corepack enable`)
- Xcode Command Line Tools (`xcode-select --install`)

```sh
git clone https://github.com/ddmiller1995/simple-pdf.git
cd simple-pdf
pnpm install
pnpm dist:mac
open release/
```

Drag `release/mac-arm64/Simple PDF.app` into Applications, or open the `.dmg` in `release/`.

## Using it

| To… | Do this |
|---|---|
| Open a PDF | **Open** (⌘O), or drag a PDF onto the window. In Finder you can also use **Open With → Simple PDF**. |
| Fill a form field | Click the field and type. |
| Add text anywhere | **Text** tool (T), then click on the page and type. |
| Add your signature | **Sign** → **Add signature…** and pick a photo or scan of your signature on white paper. Adjust **Sensitivity** if needed, then **Save**. It's kept for next time. |
| Place a signature | **Sign**, then drag a signature onto the page. Or click it and click on the page to stamp it; Shift-click to keep stamping. Press Esc to cancel. |
| Move, resize, delete | **Select** tool (V), then drag an item. Drag a corner to scale (text gets larger or smaller); drag a side handle of a text box to change its width. Delete removes. Arrow keys nudge. |
| Undo / redo | ⌘Z / ⇧⌘Z |
| Save | ⌘S saves to a new `-signed.pdf` file. ⇧⌘S is Save As. |

**Tips for signature photos:** sign with a dark pen on plain white paper, and take the photo in even light, filling most of the frame. If you photographed it on lined paper, tick **Remove lines**.

**Limitations:** password-protected PDFs and XFA forms open view-only. Form-field values in non-Latin scripts (e.g. Cyrillic, Chinese) are saved as fillable fields rather than baked into the page.

## Development

Requires Node 24 and pnpm (see above).

```sh
pnpm install
pnpm dev          # run the app with live reload
pnpm test         # unit tests (Vitest)
pnpm e2e          # end-to-end tests against the built app (Playwright)
pnpm typecheck && pnpm lint
```

Built with Electron, React and TypeScript. [PDF.js](https://mozilla.github.io/pdf.js/) renders pages and [pdf-lib](https://github.com/cantoo-scribe/pdf-lib) writes the saved file. The design and build plan is in [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md). Releasing and code signing are covered in [`docs/RELEASING.md`](docs/RELEASING.md), and the manual test checklist is [`docs/MANUAL_QA.md`](docs/MANUAL_QA.md).

The bundled Noto Sans font is licensed under the SIL Open Font License (`resources/fonts/OFL.txt`).
