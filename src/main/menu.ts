import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import { IPC_CHANNELS, type MenuCommand } from '../shared/ipc';

const isMac = process.platform === 'darwin';

function send(cmd: MenuCommand): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  win?.webContents.send(IPC_CHANNELS.event.menu, cmd);
}

/**
 * Items the renderer's keydown handler already handles (the single source of shortcuts, so
 * Playwright can test them). `registerAccelerator: false` shows the accelerator in the menu but
 * does not register it, so a keypress never fires twice. Clicking the item sends the command.
 */
function cmdItem(
  label: string,
  cmd: MenuCommand,
  accelerator?: string,
): MenuItemConstructorOptions {
  return {
    label,
    ...(accelerator ? { accelerator, registerAccelerator: false } : {}),
    click: () => send(cmd),
  };
}

export function installMenu(): void {
  const devTools: MenuItemConstructorOptions[] = app.isPackaged
    ? []
    : [{ type: 'separator' }, { role: 'toggleDevTools' }];
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        cmdItem('Open…', 'open', 'CmdOrCtrl+O'),
        { type: 'separator' },
        cmdItem('Save', 'save', 'CmdOrCtrl+S'),
        cmdItem('Save As…', 'saveAs', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        { role: 'close' },
        ...(isMac ? [] : [{ role: 'quit' } as MenuItemConstructorOptions]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        // Custom items, not the undo/redo roles: the renderer owns the document history.
        cmdItem('Undo', 'undo', 'CmdOrCtrl+Z'),
        cmdItem('Redo', 'redo', 'Shift+CmdOrCtrl+Z'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        cmdItem('Delete', 'delete'),
        { role: 'selectAll' },
        { type: 'separator' },
        cmdItem('Select Tool', 'toolSelect', 'V'),
        cmdItem('Text Tool', 'toolText', 'T'),
      ],
    },
    {
      label: 'View',
      submenu: [
        cmdItem('Zoom In', 'zoomIn', 'CmdOrCtrl+='),
        cmdItem('Zoom Out', 'zoomOut', 'CmdOrCtrl+-'),
        cmdItem('Fit Width', 'zoomFit', 'CmdOrCtrl+0'),
        ...devTools,
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    ...(isMac ? [{ role: 'help', submenu: [] } as MenuItemConstructorOptions] : []),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
