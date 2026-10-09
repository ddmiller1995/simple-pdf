import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

export const ROOT = resolve(__dirname, '../..');

/**
 * Launch the BUILT app (`out/main/index.js`; `pnpm e2e` builds first). Returns the app and its
 * first window. Later tasks may pass extra env vars (e.g. test hooks) via `env`.
 * Each launch gets a fresh temporary userData dir unless `env.SIMPLE_PDF_USER_DATA` is given
 * (pass the same dir to two launches to test persistence across restarts).
 */
export async function launchApp(
  env: Record<string, string> = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [ROOT],
    cwd: ROOT,
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: '',
      SIMPLE_PDF_USER_DATA: mkdtempSync(join(tmpdir(), 'simple-pdf-e2e-')),
      ...env,
    } as Record<string, string>,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}
