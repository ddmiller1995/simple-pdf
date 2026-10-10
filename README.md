# Simple PDF

A small Mac app for filling out and signing PDFs. Open a PDF, type into its form fields or anywhere on the page, drop in your signature, and save a signed copy.

It works entirely offline. Nothing you open or sign leaves your computer.

What it does:

- View multi-page PDFs
- Fill in form fields (text, checkboxes, radio buttons, dropdowns)
- Add text anywhere on a page
- Sign with a photo of your actual signature. The app strips out the paper background, and you can stamp it on as many pages as you need.
- Save to a new file. Everything you added is merged into the page, so it looks the same in Preview, Acrobat or a browser. The original isn't touched.

Right now there's only a build for Apple Silicon Macs (M1 or newer).

## Installing

### Download it

1. Grab the `.dmg` from the [latest release](https://github.com/ddmiller1995/simple-pdf/releases/latest).
2. Open it and drag Simple PDF into Applications.
3. Open the app. macOS will say it can't verify the developer. Click Done.
4. Go to System Settings → Privacy & Security, scroll down, and click **Open Anyway** next to the Simple PDF message.

You only have to do this the first time. The warning shows up because the app isn't registered with Apple, which costs $99 a year. The code is all here if you want to check it.

If you'd rather use Terminal, this does the same thing as steps 3 and 4:

```sh
xattr -dr com.apple.quarantine "/Applications/Simple PDF.app"
```

### Build it yourself

You need Node 24, [pnpm](https://pnpm.io/installation) and the Xcode command line tools (`xcode-select --install`). A copy you build yourself won't trigger the warning above.

```sh
git clone https://github.com/ddmiller1995/simple-pdf.git
cd simple-pdf
pnpm install
pnpm dist:mac
```

The app ends up in `release/mac-arm64/`. Drag it into Applications.

## Using it

- **Open a file:** ⌘O, or drag a PDF onto the window.
- **Fill a form:** click a field and type.
- **Add text:** press T (or click Text), click on the page, and type.
- **Add a signature:** click Sign → Add signature… and pick a photo of your signature. Dark pen on plain white paper works best. If the result looks patchy, move the Sensitivity slider. If you signed on lined paper, check Remove lines. Signatures are saved for next time.
- **Place a signature:** click it in the Sign menu, then click where you want it on the page. Shift-click to keep stamping (useful for initials), Esc to stop. You can also just drag it onto the page.
- **Move or resize:** press V (or click Select) and drag. Corners make text or a signature bigger or smaller. The side handles on a text box change its width.
- **Undo:** ⌘Z. Redo is ⇧⌘Z.
- **Save:** ⌘S saves a copy named `<file>-signed.pdf`. ⇧⌘S lets you pick the name.

A few things it can't do yet: password-protected PDFs and XFA forms open read-only, and form fields typed in non-Latin scripts (Cyrillic, Chinese, etc.) are saved as editable fields instead of being merged into the page.

## Development

```sh
pnpm install
pnpm dev        # run with live reload
pnpm test       # unit tests
pnpm e2e        # end-to-end tests
```

It's an Electron app using React, [PDF.js](https://mozilla.github.io/pdf.js/) for rendering and [pdf-lib](https://github.com/cantoo-scribe/pdf-lib) for saving. More detail in [docs/](docs/): the original implementation plan, how releases work, and a manual test checklist.

## License

MIT. See [LICENSE](LICENSE). The bundled Noto Sans font is under the SIL Open Font License (`resources/fonts/OFL.txt`).
