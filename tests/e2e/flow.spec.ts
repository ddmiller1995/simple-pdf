import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { findText, inspectPdf } from '../helpers/inspectPdf';
import { launchApp, ROOT } from './launch';

const fixture = (name: string): string => resolve(ROOT, 'tests/fixtures', name);
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  await app?.close().catch(() => undefined);
  app = undefined;
});

// The whole user journey through the real UI: open -> fill fields -> free text -> import a
// signature from a (synthetic) phone photo through the real import dialog -> stamp it -> save ->
// inspect the output file.
test('open, fill, add text, import + stamp a signature, save, verify the output', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'simple-pdf-flow-')), 'agreement-signed.pdf');
  let page;
  ({ app, page } = await launchApp({
    SIMPLE_PDF_E2E_OPEN: fixture('acroform.pdf'),
    SIMPLE_PDF_E2E_SAVE: out,
  }));

  // Empty state, then open.
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await page.getByTestId('open-button').click();
  await expect(page.locator('[data-page-slot]')).toHaveCount(1);
  await expect(page.locator('.page-view canvas')).toBeVisible();

  // Fill form fields.
  await page.locator('input[name="fullName"]').fill('Ada Lovelace');
  await page.locator('select[name="country"]').selectOption({ label: 'Canada' });

  // Free text, in the empty area below the form.
  await page.getByTestId('viewer').evaluate((el) => (el.scrollTop = el.scrollHeight));
  const pageBox = (await page.locator('.page-view').boundingBox())!;
  const k = pageBox.width / 612;
  const bottom = pageBox.y + pageBox.height; // page bottom in window px; pt y is measured from top
  const atY = (pt: number): number => bottom - (792 - pt) * k;
  await page.getByTestId('tool-text').click();
  await page.mouse.click(pageBox.x + 90 * k, atY(620));
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.type('Dated 2026-10-09');
  await page.keyboard.press('Escape');
  await page.getByTestId('tool-select').click();
  await expect(page.getByTestId('text-content')).toContainText('Dated 2026-10-09');

  // Import a signature from a photo through the real dialog (no native file picker).
  await page.getByTestId('sign-button').click();
  await page.getByRole('button', { name: 'Add signature…' }).click();
  const dialog = page.getByTestId('signature-import-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('signature-file-input').setInputFiles(fixture('sig-phone.jpg'));
  await expect(page.getByTestId('signature-result')).toBeVisible();
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('signature-item')).toHaveCount(1);

  // Arm it and stamp it near the bottom of the page.
  await page.getByTestId('signature-item').locator('.sig-thumb').click();
  await expect(page.getByTestId('stamp-hint')).toBeVisible();
  await page.mouse.click(pageBox.x + 200 * k, atY(700));
  await expect(page.getByTestId('image-overlay')).toHaveCount(1);
  await expect(page.getByTestId('stamp-hint')).toHaveCount(0);

  // Save (Cmd+S -> Save As hook).
  await page.keyboard.press(`${mod}+s`);
  await expect(page.getByTestId('save-toast')).toContainText('agreement-signed.pdf');
  expect(existsSync(out)).toBe(true);

  // Verify the output.
  const info = await inspectPdf(new Uint8Array(readFileSync(out)));
  expect(info.allText).toContain('Ada Lovelace');
  expect(info.allText).toContain('Canada');
  expect(info.allText).toContain('Dated 2026-10-09');
  expect(info.pages.every((p) => p.fields.length === 0)).toBe(true);
  const p0 = info.pages[0]!;
  expect(p0.images).toHaveLength(1);
  const img = p0.images[0]!;
  expect(Math.abs(img.screen.left + img.screen.width / 2 - 200)).toBeLessThanOrEqual(1);
  expect(Math.abs(img.screen.top + img.screen.height / 2 - 700)).toBeLessThanOrEqual(1);
  const dated = findText(p0, 'Dated 2026-10-09');
  expect(Math.abs(dated.screen.x - 90)).toBeLessThanOrEqual(2);
});
