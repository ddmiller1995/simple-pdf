import { resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

export const ROOT = resolve(__dirname, '../..');

/**
 * Launch the BUILT app (`out/main/index.js`; `pnpm e2e` builds first). Returns the app and its
 * first window. Later tasks may pass extra env vars (e.g. test hooks) via `env`.
 */
export async function launchApp(
  env: Record<string, string> = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [ROOT],
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RENDERER_URL: '', ...env } as Record<string, string>,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}
