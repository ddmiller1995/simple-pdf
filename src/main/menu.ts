import { Menu } from 'electron';

// T0 stub. T6 builds the full native menu (File/Edit/View/Window/Help) and sends
// `MenuCommand`s to the renderer on IPC_CHANNELS.event.menu.
export function installMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }]),
  );
}
