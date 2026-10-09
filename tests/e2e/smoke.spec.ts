import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp } from './launch';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
});

test.afterAll(async () => {
  await app?.close();
});

test('launches and shows the empty state', async () => {
  await expect(page.getByText('Open a PDF or drag one here')).toBeVisible();
  expect(await page.title()).toBe('Simple PDF');
});

test('renderer is isolated: typed bridge only, no Node', async () => {
  const info = await page.evaluate(() => ({
    api: Object.keys(window.api).sort(),
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
  }));
  expect(info.require).toBe('undefined');
  expect(info.process).toBe('undefined');
  expect(info.api).toEqual(
    [
      'addSignature',
      'deleteSignature',
      'listSignatures',
      'onMenu',
      'onOpenFile',
      'openPdfDialog',
      'readPdf',
      'savePdfDialog',
      'setDirty',
      'writePdf',
    ].sort(),
  );
});

test('signature library starts empty in an isolated profile', async () => {
  const sigs = await page.evaluate(() => window.api.listSignatures());
  expect(sigs).toEqual([]);
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  expect(userData).toContain('simple-pdf-e2e-');
});

test('window is sandboxed and window.open is denied', async () => {
  const opened = await page.evaluate(() => window.open('https://example.com') === null);
  expect(opened).toBe(true);
  expect(app.windows()).toHaveLength(1);
});

test('network is blocked in the main process', async () => {
  const result = await app.evaluate(async ({ session }) => {
    try {
      await session.defaultSession.fetch('https://example.com/');
      return 'fetched';
    } catch (e) {
      return `blocked: ${String(e)}`;
    }
  });
  expect(result).toMatch(/^blocked/);
});

test('renderer fetch to the network fails', async () => {
  const result = await page.evaluate(() =>
    fetch('https://example.com/').then(
      () => 'fetched',
      () => 'blocked',
    ),
  );
  expect(result).toBe('blocked');
});
