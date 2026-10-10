# Manual QA checklist

Run this once on the packaged app before calling v1 done. Record the date, OS, app version and
any failures at the bottom.

## Setup

- [ ] Turn Wi-Fi off (and unplug Ethernet). The whole checklist must work offline.
- [ ] Launch the packaged app (not `pnpm dev`).
- [ ] Have ready: a real multi-page PDF (a lease or tax form), a phone photo of your signature and
      of your initials, and `tests/fixtures/encrypted.pdf`.

## 1. Opening and viewing

- [ ] The empty state is shown with an "Open PDF…" button. Light and dark system appearance both look right.
- [ ] Open the multi-page PDF (Cmd+O, the toolbar button, or drag it onto the window).
- [ ] It scrolls smoothly, the page indicator tracks the scroll, and pages look crisp on Retina.
- [ ] Zoom in, out and Fit (toolbar and Cmd+=, Cmd+-, Cmd+0). Pages stay white in dark mode.
- [ ] Hover each toolbar button: the tooltip names the action and its shortcut.

## 2. Filling forms and free text

- [ ] Fill the AcroForm fields (text, checkbox, radio, dropdown, list).
- [ ] Text tool (T): click on two different pages and type. The box grows as you type; Esc finishes.
- [ ] Select a text box. Drag a corner: the text and box scale together and the opposite corner stays put.
- [ ] Drag the middle left/right handles: the box width changes and the text re-wraps, size unchanged.
- [ ] The font-size dropdown shows the current size (including non-preset sizes after a corner drag).
- [ ] Tab reaches each text box; Enter edits it; Delete removes it; arrow keys nudge it.

## 3. Signatures

- [ ] Sign → Add signature…: import the phone photo. The background is removed cleanly; adjust
      sensitivity or Remove lines if needed. Save it. Repeat for initials.
- [ ] Click a saved signature: the cursor becomes a crosshair, a ghost follows it, and the toolbar
      shows the hint. Click a page: it is placed centred on the cursor and stamp mode ends.
- [ ] Arm again and Shift+click on several pages: each click stamps and stays armed. Esc cancels.
      A toolbar click or choosing another tool also cancels.
- [ ] Drag a thumbnail straight onto a page: it lands where you drop it.
- [ ] Resize (corner handles keep the aspect ratio), move, delete and undo/redo (Cmd+Z, Cmd+Shift+Z).

## 4. Saving

- [ ] Cmd+S the first time: Save As opens, defaulting to `<name>-signed.pdf` next to the original.
- [ ] Make another change and Cmd+S again: it writes to the same output file without a dialog.
- [ ] Open the output in **macOS Preview, Chrome and Adobe Reader**: everything is in the same place,
      nothing is editable or movable, and the text is selectable.
- [ ] The original file is unchanged (compare its modified time or checksum).
- [ ] Close the window with unsaved changes: the Save / Don't Save / Cancel prompt appears and each
      choice does the right thing. Also check Quit and opening another file.

## 5. View-only and errors

- [ ] Open `encrypted.pdf`: the view-only banner is shown, the tools and Save are disabled.
- [ ] Open a file that is not a PDF: a friendly error is shown and the app stays usable.

## 6. Accessibility

- [ ] Every toolbar button is reachable with Tab and shows a visible focus ring.
- [ ] With VoiceOver on, buttons read as their names (Zoom out, Fit width, Save, ...).

## Results

| Date | OS / app version | Tester | Failures / notes |
|---|---|---|---|
| | | | |
