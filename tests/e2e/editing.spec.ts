import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { findText, inspectPdf } from '../helpers/inspectPdf';
import { launchApp, ROOT } from './launch';

// T7 user-feedback items: (1) corner handles scale text, edge handles change width;
// (2) signature stamp mode. Both run on rotated.pdf, whose page 2 (index 1) is rotated 90 degrees.

const fixture = (name: string): string => resolve(ROOT, 'tests/fixtures', name);
const baselineOffset = (fs: number): number => 0.988 * fs;
const UNDO = 'ControlOrMeta+z';

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

type TestHook = {
  exportCurrent(): Promise<number[]>;
  state(): { overlays: unknown[]; dirty: boolean; pastLength: number; futureLength: number };
};
type TextState = { fontSize: number; rect: { x: number; y: number; width: number; height: number } };

async function setup(): Promise<Page> {
  let page: Page;
  ({ app, page } = await launchApp({ SIMPLE_PDF_E2E_OPEN: fixture('rotated.pdf') }));
  await page.addInitScript(() => {
    (window as unknown as { __SIMPLE_PDF_E2E__: boolean }).__SIMPLE_PDF_E2E__ = true;
  });
  await page.reload();
  const png = readFileSync(fixture('sig-clean.png')).toString('base64');
  await page.evaluate(async (b64) => {
    await window.api.addSignature({
      label: 'Test signature',
      kind: 'signature',
      pngDataUrl: `data:image/png;base64,${b64}`,
    });
  }, png);
  await page.getByTestId('open-button').click();
  await expect(page.locator('[data-page-slot]')).toHaveCount(4);
  await expect(page.locator('[data-page-index="0"] canvas')).toBeVisible();
  return page;
}

const pageBox = (page: Page, i: number) => page.locator(`.page-view[data-page-index="${i}"]`);
const hook = (page: Page) =>
  page.evaluate(() => (window as unknown as { __simplePdfTest: TestHook }).__simplePdfTest.state());

async function exportBytes(page: Page): Promise<Uint8Array> {
  const arr = await page.evaluate(() =>
    (window as unknown as { __simplePdfTest: TestHook }).__simplePdfTest.exportCurrent(),
  );
  return Uint8Array.from(arr);
}

/** Element rect in page points (visual, relative to the page's top-left), independent of zoom. */
async function ptRect(el: Locator, pageIndex: number) {
  return el.evaluate((node, idx) => {
    const v = document.querySelector(`.page-view[data-page-index="${idx}"]`)!.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    const k = (idx % 2 === 1 ? 792 : 612) / v.width;
    return {
      left: (r.left - v.left) * k,
      top: (r.top - v.top) * k,
      width: r.width * k,
      height: r.height * k,
    };
  }, pageIndex);
}

function expectClose(actual: number, expected: number, tol: number, what: string): void {
  expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tol);
}

async function showPage(page: Page, i: number): Promise<void> {
  await page.locator(`[data-page-slot="${i}"]`).evaluate((e) => e.scrollIntoView());
  await expect(page.locator(`.page-view[data-page-index="${i}"] canvas`)).toBeVisible();
}

async function addText(page: Page, pageIndex: number, text: string, x: number, y: number) {
  await showPage(page, pageIndex);
  await page.getByTestId('tool-text').click();
  const box = (await pageBox(page, pageIndex).boundingBox())!;
  await page.mouse.click(box.x + x, box.y + y);
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await page.getByTestId('tool-select').click();
  await expect(page.getByTestId('text-editor')).toHaveCount(0);
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

const center = async (loc: Locator) => {
  const b = (await loc.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test('corner drag scales the text (font + box, anchored), one undo step, export matches', async () => {
  const page = await setup();
  await addText(page, 1, 'Scale me', 120, 160);
  const textEl = page.getByTestId('text-overlay');
  await textEl.click();
  await expect(page.locator('.overlay-item.selected')).toHaveCount(1);

  const before = (await hook(page)).overlays[0] as TextState;
  const startPast = (await hook(page)).pastLength;
  const r0 = await ptRect(textEl, 1);

  // Drag the south-east corner diagonally: the north-west corner must stay put.
  await drag(page, await center(textEl.locator('[data-handle="se"]')), 80, 40);
  const after = (await hook(page)).overlays[0] as TextState;
  expect(after.fontSize).toBeGreaterThan(before.fontSize + 1);
  expect((await hook(page)).pastLength).toBe(startPast + 1); // one drag = one undo step

  const r1 = await ptRect(textEl, 1);
  expectClose(r1.left, r0.left, 0.6, 'anchored left');
  expectClose(r1.top, r0.top, 0.6, 'anchored top');
  expectClose(r1.width / r0.width, after.fontSize / before.fontSize, 0.02, 'width scales with font');
  expectClose(r1.height / r0.height, after.fontSize / before.fontSize, 0.02, 'height scales with font');

  // The dropdown shows the (non-preset) size, rounded to 0.5pt.
  const shown = Math.round(after.fontSize * 2) / 2;
  await expect(page.getByTestId('font-size')).toHaveValue(String(after.fontSize));
  await expect(page.getByTestId('font-size').locator('option:checked')).toHaveText(String(shown));

  // Export round-trip: position and size match to +-1pt on the rotated page.
  const out = await inspectPdf(await exportBytes(page));
  const item = findText(out.pages[1]!, 'Scale me');
  expectClose(item.screen.x, r1.left, 1, 'exported x');
  expectClose(item.screen.y, r1.top + baselineOffset(after.fontSize), 1, 'exported baseline');
  expectClose(item.sizePx, after.fontSize, 1, 'exported font size');

  // Opposite corner anchoring from the north-west handle: the south-east corner stays put.
  const seBefore = { x: r1.left + r1.width, y: r1.top + r1.height };
  await drag(page, await center(textEl.locator('[data-handle="nw"]')), 30, 15);
  const r2 = await ptRect(textEl, 1);
  expectClose(r2.left + r2.width, seBefore.x, 0.6, 'anchored right');
  expectClose(r2.top + r2.height, seBefore.y, 0.6, 'anchored bottom');
  expect(((await hook(page)).overlays[0] as TextState).fontSize).toBeLessThan(after.fontSize);

  // Undo steps back through both drags one at a time.
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press(UNDO);
  expectClose(((await hook(page)).overlays[0] as TextState).fontSize, after.fontSize, 0.001, 'undo 1');
  await page.keyboard.press(UNDO);
  expectClose(((await hook(page)).overlays[0] as TextState).fontSize, before.fontSize, 0.001, 'undo 2');
});

test('font size is clamped to 6..96pt', async () => {
  const page = await setup();
  await addText(page, 0, 'Tiny', 100, 100);
  const textEl = page.getByTestId('text-overlay');
  await textEl.click();
  // Shrink far past the minimum.
  await drag(page, await center(textEl.locator('[data-handle="se"]')), -400, -200);
  expectClose(((await hook(page)).overlays[0] as TextState).fontSize, 6, 0.001, 'min');
  // Grow far past the maximum (the page edge may stop it earlier, never beyond 96).
  await drag(page, await center(textEl.locator('[data-handle="se"]')), 2000, 2000);
  const grown = ((await hook(page)).overlays[0] as TextState).fontSize;
  expect(grown).toBeLessThanOrEqual(96.0001);
  expect(grown).toBeGreaterThan(30);
});

test('edge handles change the width and re-wrap without scaling the font', async () => {
  const page = await setup();
  await addText(page, 0, 'one two three four five six', 80, 100);
  const textEl = page.getByTestId('text-overlay');
  await textEl.click();
  const before = (await hook(page)).overlays[0] as TextState;
  const r0 = await ptRect(textEl, 0);
  const startPast = (await hook(page)).pastLength;

  await drag(page, await center(textEl.locator('[data-handle="e"]')), -r0.width * 0.5, 0);
  const after = (await hook(page)).overlays[0] as TextState;
  expect(after.fontSize).toBe(before.fontSize);
  expect(after.rect.width).toBeLessThan(before.rect.width * 0.7);
  expect(after.rect.height).toBeGreaterThan(before.rect.height * 1.5); // wrapped to more lines
  expect((await hook(page)).pastLength).toBe(startPast + 1);
  const r1 = await ptRect(textEl, 0);
  expectClose(r1.left, r0.left, 0.6, 'left edge fixed');

  // The left edge handle keeps the right edge fixed.
  const right = r1.left + r1.width;
  await drag(page, await center(textEl.locator('[data-handle="w"]')), 20, 0);
  const r2 = await ptRect(textEl, 0);
  expectClose(r2.left + r2.width, right, 0.6, 'right edge fixed');
  expect(((await hook(page)).overlays[0] as TextState).fontSize).toBe(before.fontSize);

  // Signature corners are unchanged: no edge handles on images.
  await page.getByTestId('sign-button').click();
  await page.getByTestId('signature-item').locator('.sig-thumb').click();
  await pageBox(page, 0).click({ position: { x: 300, y: 300 } });
  await expect(page.getByTestId('image-overlay').locator('[data-handle]')).toHaveCount(4);
});

test('stamp mode: arm, ghost, place at the cursor on a rotated page (+-1pt), disarm', async () => {
  const page = await setup();
  await showPage(page, 1);
  await page.getByTestId('sign-button').click();
  await expect(page.getByTestId('stamp-hint-text')).toContainText('Shift+click');
  await page.getByTestId('signature-item').locator('.sig-thumb').click();

  // Armed: popover closed, hint shown, crosshair cursor, nothing placed yet.
  await expect(page.getByTestId('sign-popover')).toHaveCount(0);
  await expect(page.getByTestId('stamp-hint')).toBeVisible();
  await expect(page.getByTestId('image-overlay')).toHaveCount(0);
  const layer = page.getByTestId('overlay-layer').first();
  await expect(layer).toHaveClass(/stamp-mode/);
  expect(await layer.evaluate((e) => getComputedStyle(e).cursor)).toBe('crosshair');

  // The ghost follows the cursor over a page.
  const p1 = (await pageBox(page, 1).boundingBox())!;
  await page.mouse.move(p1.x + 200, p1.y + 150);
  await page.mouse.move(p1.x + 300, p1.y + 250);
  const ghost = page.getByTestId('stamp-ghost');
  await expect(ghost).toBeVisible();
  const g = await center(ghost);
  expectClose(g.x, p1.x + 300, 1, 'ghost x');
  expectClose(g.y, p1.y + 250, 1, 'ghost y');

  // Click places it centred on the cursor (PDF-space check via the export), and disarms.
  await page.mouse.click(p1.x + 300, p1.y + 250);
  const sig = page.getByTestId('image-overlay');
  await expect(sig).toHaveCount(1);
  await expect(page.getByTestId('stamp-hint')).toHaveCount(0);
  await expect(ghost).toHaveCount(0);
  const k = 792 / p1.width;
  const out = await inspectPdf(await exportBytes(page));
  const img = out.pages[1]!.images[0]!;
  expect(img.upright).toBe(true);
  expectClose(img.screen.left + img.screen.width / 2, 300 * k, 1, 'exported centre x');
  expectClose(img.screen.top + img.screen.height / 2, 250 * k, 1, 'exported centre y');
  expectClose(img.screen.width, 150, 1, 'default width');

  // Another click on the page now does nothing (disarmed).
  await page.mouse.click(p1.x + 500, p1.y + 400);
  await expect(page.getByTestId('image-overlay')).toHaveCount(1);
});

test('stamp mode: placement is clamped to the page; Shift+click stamps repeatedly; Esc cancels', async () => {
  const page = await setup();
  await showPage(page, 1);
  const arm = async () => {
    await page.getByTestId('sign-button').click();
    await page.getByTestId('signature-item').locator('.sig-thumb').click();
    await expect(page.getByTestId('stamp-hint')).toBeVisible();
  };
  const p1 = (await pageBox(page, 1).boundingBox())!;

  // Clamp: a click in the very corner keeps the whole signature on the page.
  await arm();
  await page.mouse.click(p1.x + 2, p1.y + 2);
  await expect(page.getByTestId('image-overlay')).toHaveCount(1);
  const r = await ptRect(page.getByTestId('image-overlay'), 1);
  expect(r.left).toBeGreaterThanOrEqual(-0.5);
  expect(r.top).toBeGreaterThanOrEqual(-0.5);
  expectClose(r.left, 0, 1, 'clamped to left edge');
  expectClose(r.top, 0, 1, 'clamped to top edge');

  // Shift+click stamps and stays armed (initialling many pages).
  await arm();
  await page.keyboard.down('Shift');
  await page.mouse.click(p1.x + 300, p1.y + 200);
  await page.mouse.click(p1.x + 300, p1.y + 400);
  await page.keyboard.up('Shift');
  await expect(page.getByTestId('image-overlay')).toHaveCount(3);
  await expect(page.getByTestId('stamp-hint')).toBeVisible();

  // Esc cancels; a later click places nothing.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('stamp-hint')).toHaveCount(0);
  await page.mouse.click(p1.x + 450, p1.y + 300);
  await expect(page.getByTestId('image-overlay')).toHaveCount(3);

  // A toolbar click cancels.
  await arm();
  await page.getByTestId('zoom-label').click();
  await expect(page.getByTestId('stamp-hint')).toHaveCount(0);

  // Choosing another tool cancels, and the Text tool then works normally.
  await arm();
  await page.getByTestId('tool-text').click();
  await expect(page.getByTestId('stamp-hint')).toHaveCount(0);
  await page.mouse.click(p1.x + 450, p1.y + 300);
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await expect(page.getByTestId('image-overlay')).toHaveCount(3);
});

test('text boxes are reachable and editable from the keyboard', async () => {
  const page = await setup();
  await addText(page, 0, 'Keyboard', 100, 100);
  const textEl = page.getByTestId('text-overlay');
  await expect(textEl).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('Escape'); // deselects
  await expect(page.locator('.overlay-item.selected')).toHaveCount(0);
  await textEl.focus();
  await expect(page.locator('.overlay-item.selected')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.type('!');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('text-content')).toContainText('Keyboard!');
});
