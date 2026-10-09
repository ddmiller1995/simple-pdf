import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { findText, inspectPdf } from '../helpers/inspectPdf';
import { launchApp, ROOT } from './launch';

const fixture = (name: string): string => resolve(ROOT, 'tests/fixtures', name);
/** Baseline below the line-box top for Noto Sans (see pdf/textLayout.ts baselineOffset). */
const baselineOffset = (fs: number): number => 0.988 * fs;
const UNDO = 'ControlOrMeta+z';
const REDO = 'ControlOrMeta+Shift+z';

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Launch with rotated.pdf as the "Open" target, the E2E hook flag set, one signature saved. */
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

type PtRect = { left: number; top: number; width: number; height: number };

/** Element rect in page points (visual, top-left of the page), independent of zoom. */
async function ptRect(_page: Page, el: Locator, pageIndex: number): Promise<PtRect> {
  return el.evaluate(
    (node, idx) => {
      const view = document.querySelector(`.page-view[data-page-index="${idx}"]`)!;
      const v = view.getBoundingClientRect();
      const r = node.getBoundingClientRect();
      // Letter page: 612 wide upright, 792 wide when rotated 90/270 (pages 1 and 3 here).
      const widthPt = idx % 2 === 1 ? 792 : 612;
      const k = widthPt / v.width;
      return {
        left: (r.left - v.left) * k,
        top: (r.top - v.top) * k,
        width: r.width * k,
        height: r.height * k,
      };
    },
    pageIndex,
  );
}

const pageBox = (page: Page, i: number) => page.locator(`.page-view[data-page-index="${i}"]`);

type TestHook = {
  exportCurrent(): Promise<number[]>;
  state(): { overlays: unknown[]; dirty: boolean; pastLength: number; futureLength: number };
};

async function exportBytes(page: Page): Promise<Uint8Array> {
  const arr = await page.evaluate(() => (window as unknown as { __simplePdfTest: TestHook }).__simplePdfTest.exportCurrent());
  return Uint8Array.from(arr);
}

const state = (page: Page) => page.evaluate(() => (window as unknown as { __simplePdfTest: TestHook }).__simplePdfTest.state());

function expectClose(actual: number, expected: number, tol: number, what: string): void {
  expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tol);
}

test('text on a rotated page and a dragged signature: anchoring, undo/redo, export, delete', async () => {
  const testInfo = test.info();
  const page = await setup();

  // ---- Signature: drag a thumbnail from the Sign popover onto page 1 --------------------------
  await page.getByTestId('sign-button').click();
  const thumb = page.getByTestId('signature-item').locator('.sig-thumb');
  await expect(thumb).toBeVisible();
  const thumbBox = (await thumb.boundingBox())!;
  const p0 = (await pageBox(page, 0).boundingBox())!;
  const drop = { x: p0.x + 300, y: p0.y + 200 };
  await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(drop.x - 30, drop.y - 30, { steps: 6 });
  await expect(page.locator('.sig-ghost')).toBeVisible();
  await page.mouse.move(drop.x, drop.y, { steps: 3 });
  await page.mouse.up();

  const sig = page.getByTestId('image-overlay');
  await expect(sig).toHaveCount(1);
  await expect(page.getByTestId('sign-popover')).toHaveCount(0);
  const zoom0 = p0.width / 612;
  let sigPt = await ptRect(page, sig, 0);
  expectClose(sigPt.left + sigPt.width / 2, 300 / zoom0, 1.5, 'drop centre x');
  expectClose(sigPt.top + sigPt.height / 2, 200 / zoom0, 1.5, 'drop centre y');
  expectClose(sigPt.width, 150, 1, 'default width 150pt');

  // ---- Move it: ONE undo step ----------------------------------------------------------------
  const before = await state(page);
  const sb = (await sig.boundingBox())!;
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width / 2 + 20, sb.y + sb.height / 2 + 10, { steps: 8 });
  await page.mouse.up();
  const after = await state(page);
  expect(after.pastLength).toBe(before.pastLength + 1);
  const moved = await ptRect(page, sig, 0);
  expectClose(moved.left - sigPt.left, 20 / zoom0, 1.5, 'moved dx');
  expectClose(moved.top - sigPt.top, 10 / zoom0, 1.5, 'moved dy');
  sigPt = moved;

  // ---- Text on page 2 (rotated 90) ------------------------------------------------------------
  await page.locator('[data-page-slot="1"]').evaluate((e) => e.scrollIntoView());
  await expect(page.locator('.page-view[data-page-index="1"] canvas')).toBeVisible();
  await page.getByTestId('tool-text').click();
  const p1 = (await pageBox(page, 1).boundingBox())!;
  await page.mouse.click(p1.x + 120, p1.y + 160);
  const editor = page.getByTestId('text-editor');
  await expect(editor).toBeFocused();
  await page.keyboard.type('Hello rotated');
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  const textEl = page.getByTestId('text-overlay');
  await expect(textEl).toHaveCount(1);
  await expect(page.getByTestId('text-content')).toContainText('Hello rotated');
  const textPt = await ptRect(page, textEl, 1);
  const zoom1 = p1.width / 792;
  expectClose(textPt.left, 120 / zoom1, 1.5, 'text left');

  // ---- Zoom in and out: overlays stay anchored in page points ---------------------------------
  const zoomLabel = page.getByTestId('zoom-label');
  const fitLabel = await zoomLabel.textContent();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(zoomLabel).not.toHaveText(fitLabel!);
  await expect.poll(async () => (await pageBox(page, 1).boundingBox())!.width).toBeGreaterThan(p1.width);
  const textZ = await ptRect(page, page.getByTestId('text-overlay'), 1);
  for (const k of ['left', 'top', 'width', 'height'] as const) {
    expectClose(textZ[k], textPt[k], 1, `text ${k} after zoom`);
  }
  await page.locator('[data-page-slot="0"]').evaluate((e) => e.scrollIntoView());
  const sigZ = await ptRect(page, page.getByTestId('image-overlay'), 0);
  for (const k of ['left', 'top', 'width', 'height'] as const) {
    expectClose(sigZ[k], sigPt[k], 1, `signature ${k} after zoom`);
  }
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.getByRole('button', { name: 'Zoom out' }).click();

  // ---- Export round-trip (no save UI): positions match what was placed ------------------------
  const out = await inspectPdf(await exportBytes(page));
  const img = out.pages[0]!.images[0]!;
  expectClose(img.screen.left, sigPt.left, 1, 'exported signature left');
  expectClose(img.screen.top, sigPt.top, 1, 'exported signature top');
  expectClose(img.screen.width, sigPt.width, 1, 'exported signature width');
  expectClose(img.screen.height, sigPt.height, 1, 'exported signature height');
  expect(img.upright).toBe(true);
  const item = findText(out.pages[1]!, 'Hello rotated');
  expectClose(item.screen.x, textPt.left, 1, 'exported text x');
  expectClose(item.screen.y, textPt.top + baselineOffset(12), 1, 'exported text baseline');
  expect(Math.abs(item.angleDeg)).toBeLessThan(0.01);

  // ---- Screenshot of page 2 with the text (visual parity check by eye) ------------------------
  await page.locator('[data-page-slot="1"]').evaluate((e) => e.scrollIntoView());
  await page.getByTestId('overlay-layer').nth(0).waitFor({ state: 'attached' });
  await pageBox(page, 1).screenshot({ path: testInfo.outputPath('page2-text.png') });
  await page.locator('[data-page-slot="0"]').evaluate((e) => e.scrollIntoView());
  await pageBox(page, 0).screenshot({ path: testInfo.outputPath('page1-signature.png') });

  // ---- Undo / redo ----------------------------------------------------------------------------
  // History: add signature, move signature, add text.
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press(UNDO);
  await expect(page.getByTestId('text-overlay')).toHaveCount(0);
  await page.keyboard.press(UNDO); // undo the move
  const unmoved = await ptRect(page, page.getByTestId('image-overlay'), 0);
  expectClose(unmoved.left, (sigPt.left - 20 / zoom0), 1.5, 'move undone');
  await page.keyboard.press(UNDO); // undo the placement
  await expect(page.getByTestId('image-overlay')).toHaveCount(0);
  await page.keyboard.press(REDO);
  await page.keyboard.press(REDO);
  await page.keyboard.press(REDO);
  await expect(page.getByTestId('image-overlay')).toHaveCount(1);
  await expect(page.getByTestId('text-overlay')).toHaveCount(1);

  // ---- Delete ---------------------------------------------------------------------------------
  await page.locator('[data-page-slot="1"]').evaluate((e) => e.scrollIntoView());
  await page.getByTestId('tool-select').click();
  await page.getByTestId('text-overlay').click();
  await expect(page.locator('.overlay-item.selected')).toHaveCount(1);
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('text-overlay')).toHaveCount(0);
  await page.keyboard.press(UNDO);
  await expect(page.getByTestId('text-overlay')).toHaveCount(1);
});

test('clicking a thumbnail places the signature on the visible page; typing keeps native undo', async () => {
  const page = await setup();
  await page.locator('[data-page-slot="2"]').evaluate((e) => e.scrollIntoView());
  await expect(page.getByTestId('page-indicator')).toHaveText('3 / 4');
  await page.getByTestId('sign-button').click();
  await page.getByTestId('signature-item').locator('.sig-thumb').click();
  await expect(page.getByTestId('image-overlay')).toHaveCount(1);
  const s = await state(page);
  expect((s.overlays[0] as { pageIndex: number }).pageIndex).toBe(2);

  // Cmd+Z while typing in a text box undoes typing, not the document.
  await page.getByTestId('tool-text').click();
  const p2 = (await pageBox(page, 2).boundingBox())!;
  await page.mouse.click(p2.x + 80, p2.y + 80);
  await page.keyboard.type('abc');
  await page.keyboard.press(UNDO);
  await expect(page.getByTestId('text-editor')).not.toHaveValue('abc'); // native undo ran
  expect((await state(page)).overlays).toHaveLength(1);
});
