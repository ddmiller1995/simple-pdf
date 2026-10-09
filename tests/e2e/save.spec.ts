import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { inspectPdf } from '../helpers/inspectPdf';
import { launchApp, ROOT } from './launch';

const fixture = (name: string): string => resolve(ROOT, 'tests/fixtures', name);
const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  // A dirty window would (correctly) veto a normal close, so exit the process directly.
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  await app?.close().catch(() => undefined);
  app = undefined;
});

async function launchWith(name: string, env: Record<string, string> = {}): Promise<Page> {
  let page: Page;
  ({ app, page } = await launchApp({ SIMPLE_PDF_E2E_OPEN: fixture(name), ...env }));
  await page.getByTestId('open-button').click();
  await expect(page.locator('[data-page-slot]').first()).toBeVisible();
  return page;
}

const outDir = (): string => mkdtempSync(join(tmpdir(), 'simple-pdf-out-'));

async function fillName(page: Page, value: string): Promise<void> {
  const input = page.locator('input[name="fullName"]');
  await expect(input).toBeVisible();
  await input.fill(value);
}

const windowCount = (): Promise<number> =>
  app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

const closeFirstWindow = (): Promise<void> =>
  app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());

test('fill fields -> Cmd+S -> output has the values, no fields; source unchanged', async () => {
  const out = join(outDir(), 'filled.pdf');
  const before = sha(fixture('acroform.pdf'));
  const page = await launchWith('acroform.pdf', { SIMPLE_PDF_E2E_SAVE: out });

  await expect(page.getByTestId('save-button')).toBeEnabled();
  await fillName(page, 'Ada Lovelace');
  await page.locator('select[name="country"]').selectOption({ label: 'Canada' });
  await expect.poll(() => page.title()).toContain('Edited');

  await page.keyboard.press(`${mod}+s`);
  await expect(page.getByTestId('save-toast')).toContainText('filled.pdf');
  await expect.poll(() => page.title()).not.toContain('Edited');

  expect(existsSync(out)).toBe(true);
  const info = await inspectPdf(new Uint8Array(readFileSync(out)));
  expect(info.allText).toContain('Ada Lovelace');
  expect(info.allText).toContain('Canada');
  expect(info.pages.every((p) => p.fields.length === 0)).toBe(true);
  expect(sha(fixture('acroform.pdf'))).toBe(before);
});

test('close with unsaved changes: Cancel keeps the window open', async () => {
  const page = await launchWith('acroform.pdf', { SIMPLE_PDF_E2E_UNSAVED: 'cancel' });
  await fillName(page, 'Grace');
  await expect.poll(() => page.title()).toContain('Edited');

  await closeFirstWindow();
  await expect
    .poll(() =>
      app!.evaluate(
        () => (globalThis as { __simplePdfUnsavedPrompts?: number }).__simplePdfUnsavedPrompts,
      ),
    )
    .toBe(1);
  expect(await windowCount()).toBe(1);
});

test("close with unsaved changes: Don't Save closes the window", async () => {
  const page = await launchWith('acroform.pdf', { SIMPLE_PDF_E2E_UNSAVED: 'discard' });
  await fillName(page, 'Grace');
  await expect.poll(() => page.title()).toContain('Edited');
  await closeFirstWindow();
  await expect.poll(windowCount).toBe(0);
});

test('close with unsaved changes: Save writes the file, then closes', async () => {
  const out = join(outDir(), 'closed.pdf');
  const page = await launchWith('acroform.pdf', {
    SIMPLE_PDF_E2E_UNSAVED: 'save',
    SIMPLE_PDF_E2E_SAVE: out,
  });
  await fillName(page, 'Grace Hopper');
  await expect.poll(() => page.title()).toContain('Edited');
  await closeFirstWindow();
  await expect.poll(windowCount).toBe(0);
  const info = await inspectPdf(new Uint8Array(readFileSync(out)));
  expect(info.allText).toContain('Grace Hopper');
});

test('encrypted.pdf shows the view-only banner and Save is disabled', async () => {
  const page = await launchWith('encrypted.pdf');
  await expect(page.getByTestId('view-only-banner')).toContainText('encrypted');
  await expect(page.getByTestId('save-button')).toBeDisabled();
});

test('open-file event opens the document', async () => {
  let page: Page;
  ({ app, page } = await launchApp());
  await expect(page.locator('.empty-state')).toBeVisible();
  const path = fixture('simple-3page.pdf');
  await app.evaluate(({ app }, p) => {
    app.emit('open-file', { preventDefault() {} }, p);
  }, path);
  await expect(page.locator('[data-page-slot]')).toHaveCount(3);
  await expect.poll(() => page.title()).toBe('simple-3page.pdf');
});
