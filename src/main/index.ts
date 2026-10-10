import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc';
import { installCloseGuard, registerCloseGuardIpc } from './closeGuard';
import { registerFileIpc, registerSignatureIpc } from './ipc';
import { installMenu } from './menu';
import { installSecurity } from './security';

// Test hook: E2E runs get an isolated profile so they never touch the real signature library.
const testUserData = process.env['SIMPLE_PDF_USER_DATA'];
if (testUserData && !app.isPackaged) app.setPath('userData', testUserData);

installSecurity();

// Paths to open (Finder "Open With", argv, second instance). They are queued until the renderer
// has subscribed to `onOpenFile`, then flushed.
const pendingPaths: string[] = [];
const readyContents = new Set<number>();

function openPathInWindow(path: string): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && readyContents.has(win.webContents.id)) {
    if (win.isMinimized()) win.restore();
    win.focus();
    win.webContents.send(IPC_CHANNELS.event.openFile, path);
  } else {
    pendingPaths.push(path);
    if (app.isReady() && !win) createWindow();
  }
}

const pdfArgs = (argv: string[]): string[] =>
  argv.filter((a) => /\.pdf$/i.test(a) && existsSync(a));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    for (const p of pdfArgs(argv.slice(1))) openPathInWindow(p);
  });
}

// macOS: Finder / Dock. Can fire before `ready`.
app.on('open-file', (event, path) => {
  event.preventDefault();
  openPathInWindow(path);
});

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 480,
    minHeight: 360,
    show: false,
    title: 'Simple PDF',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  installCloseGuard(win);
  const id = win.webContents.id;
  win.on('closed', () => readyContents.delete(id));
  // A reload replaces the renderer: queue opened files until the new page signals readiness.
  win.webContents.on('did-start-loading', () => readyContents.delete(id));

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}

void app.whenReady().then(() => {
  registerFileIpc();
  registerSignatureIpc();
  registerCloseGuardIpc();
  ipcMain.on(IPC_CHANNELS.send.openFileReady, (event) => {
    readyContents.add(event.sender.id);
    for (const p of pendingPaths.splice(0)) event.sender.send(IPC_CHANNELS.event.openFile, p);
  });
  pendingPaths.push(...pdfArgs(process.argv.slice(app.isPackaged ? 1 : 2)));
  installMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
