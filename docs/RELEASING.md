# Releasing Simple PDF

All commands run under Node 24 (`fnm exec --using=24 -- <cmd>`). Build output goes to `release/` (gitignored).

## Build (macOS, unsigned)

```
pnpm install
pnpm dist:mac        # electron-vite build + electron-builder --mac --arm64
pnpm verify:packaged # opt-in: launches the packaged app and checks it (see below)
```

Artifacts: `release/Simple PDF-<version>-arm64.dmg`, `release/Simple PDF-<version>-arm64-mac.zip`, and the app at `release/mac-arm64/Simple PDF.app`.

- Target is **arm64 only**. For Intel Macs add `x64` (or `universal`) to the `mac.target` arch lists in `electron-builder.yml`; the build then downloads a second Electron binary. A universal build roughly doubles the size.
- `appId` is `com.simplepdf.app`, a placeholder. Change it (and `copyright`) in `electron-builder.yml` to an identifier you own before shipping; it must match your provisioning/notarization identity.
- No `node_modules` are shipped: Vite bundles all dependencies into `out/`. The PDF.js worker, cmaps, standard fonts, wasm and Noto Sans are inside `app.asar` (`out/renderer/...`).

### What `verify:packaged` checks

`tests/packaged/packaged.spec.ts` launches `release/mac-arm64/Simple PDF.app` with Playwright (`executablePath`), opens a PDF from argv and another through the `open-file` event (what Finder sends), and asserts: pages render with ink, the assets above exist inside `app.asar`, every request URL recorded during a reload and open is `file:` (no http/https/ws/wss), and an outbound `fetch` is refused. It is not part of `pnpm e2e` because it needs a dist build first.

## First run of an unsigned build (Gatekeeper)

Unsigned apps downloaded from the internet are quarantined. On first launch macOS says the app "cannot be opened". Right-click (or Control-click) the app, choose **Open**, then **Open** again. If macOS still refuses (recent versions), run:

```
xattr -dr com.apple.quarantine "/Applications/Simple PDF.app"
```

Apps built locally and never downloaded do not get the quarantine flag.

## Code signing and notarization (later)

Requires an Apple Developer Program membership (about $99/year).

1. Create a **Developer ID Application** certificate (Xcode, Settings, Accounts, Manage Certificates, or developer.apple.com). Export it as `.p12` or keep it in your login keychain.
2. In `electron-builder.yml`, under `mac:` remove `identity: null` and uncomment `notarize: true`. Hardened runtime and `build/entitlements.mac.plist` are already configured (only `allow-jit`; no network entitlement, since the app is offline).
3. Set environment variables for the build:
   - Signing: a keychain identity is auto-discovered, or set `CSC_LINK` (path or base64 of the `.p12`) and `CSC_KEY_PASSWORD`.
   - Notarization: `APPLE_ID` (Apple ID email), `APPLE_APP_SPECIFIC_PASSWORD` (generated at appleid.apple.com, not your login password) and `APPLE_TEAM_ID` (10-character team id).
4. Run `pnpm dist:mac`. electron-builder signs, submits to Apple, waits, and staples the ticket.
5. Verify: `spctl -a -vv "release/mac-arm64/Simple PDF.app"` should report `source=Notarized Developer ID`.

## Windows and Linux (configured, not yet built or verified)

Config exists in `electron-builder.yml`. Build on the matching OS (or in CI), since native tooling differs.

- `pnpm dist:win` produces an NSIS installer (x64). Unsigned installers trigger SmartScreen warnings ("More info", "Run anyway"). Signing needs a code-signing certificate (`CSC_LINK`, `CSC_KEY_PASSWORD`, or Azure Trusted Signing).
- `pnpm dist:linux` produces an AppImage and a `.deb`. `.deb` needs `dpkg`/`fakeroot` on the build machine. AppImage needs no install (`chmod +x`).
- The `.pdf` file association (Editor role) is included for all platforms. Windows/Linux pass the file path as argv and via `second-instance`; these paths are implemented but untested.
- `build/icon.png` (1024px) is used for Windows and Linux. Windows installers normally want an `.ico`; electron-builder converts the PNG automatically.

## Icon

Source is `build/icon.svg`; `pnpm icon` regenerates `build/icon.png` and `build/icon.icns` (uses `@napi-rs/canvas` and macOS `iconutil`). Generated files are committed.
