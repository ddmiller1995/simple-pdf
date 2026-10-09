import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, ROOT } from './launch';

const fixture = (name: string): string => resolve(ROOT, 'tests/fixtures', name);

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

/**
 * Launch the app. When `name` is given, the native open dialog is bypassed via the
 * SIMPLE_PDF_E2E_OPEN test hook (main process): the Open button then opens that fixture.
 */
async function launchWith(name?: string): Promise<Page> {
  const env: Record<string, string> = name ? { SIMPLE_PDF_E2E_OPEN: fixture(name) } : {};
  let page: Page;
  ({ app, page } = await launchApp(env));
  return page;
}

/** Simulate dropping a file on the window (the renderer reads the bytes itself). */
async function dropFile(page: Page, name: string, bytes: number[], type: string): Promise<void> {
  await page.evaluate(
    ({ name, bytes, type }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], name, { type }));
      window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    },
    { name, bytes, type },
  );
}

/** True when the canvas has at least some non-white pixels (i.e. something was rendered). */
async function canvasHasInk(page: Page, index: number): Promise<boolean> {
  return page.evaluate((i) => {
    const canvas = document.querySelector<HTMLCanvasElement>(`[data-page-slot="${i}"] canvas`);
    if (!canvas || canvas.width === 0) return false;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let p = 0; p < data.length; p += 4) {
      if (data[p]! < 200 || data[p + 1]! < 200 || data[p + 2]! < 200) return true;
    }
    return false;
  }, index);
}

const slotSize = (page: Page, index: number): Promise<number[]> =>
  page.locator(`[data-page-slot="${index}"]`).evaluate((e) => [e.clientWidth, e.clientHeight]);

test('open simple-3page.pdf: 3 pages render and the indicator tracks scroll', async () => {
  const page = await launchWith('simple-3page.pdf');
  await page.getByTestId('open-button').click();

  await expect(page.locator('[data-page-slot]')).toHaveCount(3);
  await expect(page.getByTestId('page-indicator')).toHaveText('1 / 3');
  await expect.poll(() => canvasHasInk(page, 0)).toBe(true);

  await page.getByTestId('viewer').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.getByTestId('page-indicator')).toHaveText('3 / 3');
  await expect.poll(() => canvasHasInk(page, 2)).toBe(true);
});

test('zoom buttons and keyboard change the zoom within 50-400%', async () => {
  const page = await launchWith('simple-3page.pdf');
  await page.getByTestId('open-button').click();
  await expect(page.locator('[data-page-slot]')).toHaveCount(3);

  const label = page.getByTestId('zoom-label');
  const fit = await label.textContent();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(label).not.toHaveText(fit!);
  const [widthAfterIn] = await slotSize(page, 0);

  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+-');
  await expect.poll(async () => (await slotSize(page, 0))[0]).toBeLessThan(widthAfterIn!);

  for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(label).toHaveText('400%');

  await page.keyboard.press('Control+0');
  await expect(label).toHaveText(fit!);
});

test('rotated, cropbox-offset and mixed-size fixtures render at the right size', async () => {
  const page = await launchWith();
  const open = async (name: string): Promise<void> => {
    await dropFile(page, name, [...readFileSync(fixture(name))], 'application/pdf');
  };

  await open('rotated.pdf');
  await expect(page.locator('[data-page-slot]')).toHaveCount(4);
  await expect.poll(() => canvasHasInk(page, 0)).toBe(true);
  // Page 2 is /Rotate 90: displayed landscape (wider than tall).
  const [w1, h1] = await slotSize(page, 1);
  expect(w1!).toBeGreaterThan(h1!);

  await open('cropbox-offset.pdf');
  await expect(page.locator('[data-page-slot]')).toHaveCount(1);
  await expect.poll(() => canvasHasInk(page, 0)).toBe(true);
  const [cw, ch] = await slotSize(page, 0);
  expect(cw! / ch!).toBeCloseTo(400 / 500, 1); // CropBox, not MediaBox

  await open('mixed-sizes.pdf');
  await expect(page.locator('[data-page-slot]')).toHaveCount(3);
  const first = await slotSize(page, 0);
  const third = await slotSize(page, 2);
  expect(first[0]! / first[1]!).toBeCloseTo(612 / 792, 1);
  expect(third[0]! / third[1]!).toBeCloseTo(792 / 612, 1);
});

test('50-page file keeps only nearby pages rendered', async () => {
  const page = await launchWith('large-50page.pdf');
  await page.getByTestId('open-button').click();
  await expect(page.locator('[data-page-slot]')).toHaveCount(50);
  await expect.poll(() => canvasHasInk(page, 0)).toBe(true);

  await page.getByTestId('viewer').evaluate((el) => {
    el.scrollTop = el.scrollHeight / 2;
  });
  await expect(page.getByTestId('page-indicator')).not.toHaveText('1 / 50');
  await expect.poll(() => page.locator('canvas').count()).toBeLessThanOrEqual(6);
  expect(await page.locator('canvas').count()).toBeGreaterThan(0);
});

test('an unparseable file shows a friendly error and keeps the app usable', async () => {
  const page = await launchWith();
  await dropFile(page, 'broken.pdf', [1, 2, 3, 4, 5], 'application/pdf');
  await expect(page.getByTestId('open-error')).toContainText("Couldn't open this file");
  await expect(page.getByText('Open a PDF or drag one here')).toBeVisible();

  await dropFile(page, 'notes.txt', [104, 105], 'text/plain');
  await expect(page.getByTestId('open-error')).toContainText('not a PDF');
});
