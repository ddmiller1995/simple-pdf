import { app, session, type WebContents } from 'electron';

/** Origin of the Vite dev server (only set when running `pnpm dev`). */
function devServerOrigin(): string | null {
  const url = process.env['ELECTRON_RENDERER_URL'];
  if (app.isPackaged || !url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function isAllowedDevUrl(rawUrl: string): boolean {
  const origin = devServerOrigin();
  if (!origin) return false;
  try {
    const u = new URL(rawUrl);
    if (u.origin === origin) return true;
    // Vite HMR websocket: same host:port, ws(s) scheme.
    const o = new URL(origin);
    return (u.protocol === 'ws:' || u.protocol === 'wss:') && u.host === o.host;
  } catch {
    return false;
  }
}

/** Offline guarantee: cancel every network request (except the dev server in dev). */
export function blockNetwork(): void {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*'] },
    (details, callback) => {
      callback({ cancel: !isAllowedDevUrl(details.url) });
    },
  );
  // No device/notification/etc. permissions are ever needed.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
}

/** Lock a WebContents: no new windows, no navigation away from the app, no webviews. */
export function hardenWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedDevUrl(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

/** Call once, before the app is ready. */
export function installSecurity(): void {
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));
  app.whenReady().then(blockNetwork);
}
