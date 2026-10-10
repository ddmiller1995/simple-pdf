import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PDFDocument } from '@cantoo/pdf-lib';
import { PNG } from 'pngjs';
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

/** Dark pixels inside the middle of an element's screenshot: a visible tick/dot vs an empty box. */
async function inkInside(page: Page, selector: string): Promise<number> {
  const png = PNG.sync.read(await page.locator(selector).first().screenshot());
  let dark = 0;
  for (let y = Math.floor(png.height * 0.25); y < png.height * 0.75; y++) {
    for (let x = Math.floor(png.width * 0.25); x < png.width * 0.75; x++) {
      const i = (y * png.width + x) * 4;
      if (png.data[i]! + png.data[i + 1]! + png.data[i + 2]! < 3 * 110) dark++;
    }
  }
  return dark;
}

/** Click the centre of an element with the real mouse, the way a user would (no locator.check). */
async function mouseClick(page: Page, selector: string): Promise<void> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`not visible: ${selector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test('checkboxes and radio buttons toggle when clicked in Select mode, and save', async () => {
  const out = join(outDir(), 'checked.pdf');
  const page = await launchWith('acroform.pdf', { SIMPLE_PDF_E2E_SAVE: out });
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');

  const agree = page.locator('input[type="checkbox"][name="agree"]');
  await expect(agree).toBeVisible();
  const agreeSel = 'input[type="checkbox"][name="agree"]';
  expect(await inkInside(page, agreeSel)).toBe(0);
  await mouseClick(page, agreeSel);
  await expect(agree).toBeChecked();
  // The tick must actually be drawn, not just the input state (regression: blank checked boxes).
  await expect.poll(() => inkInside(page, agreeSel)).toBeGreaterThan(0);
  await mouseClick(page, agreeSel);
  await expect(agree).not.toBeChecked();
  await expect.poll(() => inkInside(page, agreeSel)).toBe(0);
  await mouseClick(page, 'input[type="checkbox"][name="agree"]');
  await expect(agree).toBeChecked();

  const radios = page.locator('input[type="radio"]');
  await mouseClick(page, 'input[type="radio"] >> nth=1');
  await expect(radios.nth(1)).toBeChecked();
  await expect.poll(() => inkInside(page, 'input[type="radio"] >> nth=1')).toBeGreaterThan(0);
  expect(await inkInside(page, 'input[type="radio"] >> nth=0')).toBe(0);

  await page.keyboard.press(`${mod}+s`);
  await expect(page.getByTestId('save-toast')).toContainText('checked.pdf');
  const form = (await PDFDocument.load(readFileSync(out))).getForm();
  expect(form.getFields()).toHaveLength(0); // flattened into the page on save
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
  // Disabled tools must not look pressed.
  await expect(page.getByTestId('tool-select')).toBeDisabled();
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'false');
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

test('writePdf refuses paths that were not chosen in the save dialog', async () => {
  const { app, page } = await launchApp({ SIMPLE_PDF_E2E: '1' });
  try {
    const err = await page.evaluate(() =>
      window.api
        .writePdf('/tmp/simple-pdf-not-approved.pdf', new TextEncoder().encode('%PDF-1.7\n'))
        .then(
          () => '',
          (e) => String(e),
        ),
    );
    expect(err).toContain('not chosen in the save dialog');
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});
