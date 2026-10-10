# Simple PDF

A straight-foward desktop app so that I never have to use Adobe Acrobat again. Supports viewing, filling out, and signing PDFs. Offline only, built with Electron for cross-platform support. 

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

You only have to do this the first time. The warning shows up because I'm not planning to distribute this and haven't paid for the $99 annual fee for a Apple Developer ID. The code is all open source if you want to verify or build it yourself. 

If you'd rather use a terminal, this does the same thing as steps 3 and 4:

```sh
xattr -dr com.apple.quarantine "/Applications/Simple PDF.app"
```

### Build it yourself

You need Node 24, [pnpm](https://pnpm.io/installation) and the Xcode command line tools (`xcode-select --install`). Building it yourself avoids that warning from Apple. 

```sh
git clone https://github.com/ddmiller1995/simple-pdf.git
cd simple-pdf
pnpm install
pnpm dist:mac
```

The app ends up in `release/mac-arm64/`. Drag it into Applications.

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
