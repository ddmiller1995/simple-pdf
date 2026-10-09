import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type Page } from '@playwright/test';

const ROOT = resolve(__dirname, '../..');
const APP = join(ROOT, 'release/mac-arm64/Simple PDF.app');
const EXE = join(APP, 'Contents/MacOS/Simple PDF');
const FIX = (name: string): string => join(ROOT, 'tests/fixtures', name);

test.skip(process.platform !== 'darwin', 'macOS packaged app only');
test.skip(!existsSync(EXE), 'run `pnpm dist:mac` first');

async function renderedPages(page: Page): Promise<{ canvases: number; inked: boolean }> {
  return page.evaluate(() => {
    const cs = Array.from(
      document.querySelectorAll<HTMLCanvasElement>('[data-testid="canvas-layer"] canvas'),
    );
    const first = cs[0];
    let inked = false;
    if (first && first.width > 0) {
      const d = first.getContext('2d')!.getImageData(0, 0, first.width, first.height).data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i]! < 200 || d[i + 1]! < 200 || d[i + 2]! < 200) {
          inked = true;
          break;
        }
      }
    }
    return { canvases: cs.length, inked };
  });
}

test('packaged app renders PDFs, ships its assets and makes no network requests', async () => {
  const app = await electron.launch({
    executablePath: EXE,
    // PDF path as argv (exercises the real startup-open path; E2E env hooks are off when packaged).
    args: [
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'simple-pdf-pkg-'))}`,
      FIX('simple-3page.pdf'),
    ],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' } as Record<string, string>,
  });
  try {
    expect(await app.evaluate(({ app: a }) => a.isPackaged)).toBe(true);
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // 1. Argv-opened PDF renders.
    await expect
      .poll(async () => (await renderedPages(page)).canvases, { timeout: 20_000 })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => (await renderedPages(page)).inked, { timeout: 20_000 })
      .toBe(true);

    // 2. Bundled assets are inside the asar (read through Electron's asar-aware fs).
    const assets = await app.evaluate(({ app: a }) => {
      const fs = process.getBuiltinModule('node:fs');
      const base = `${a.getAppPath()}/out/renderer`;
      const ls = (d: string): string[] => fs.readdirSync(`${base}/${d}`);
      return {
        appPath: a.getAppPath(),
        worker: ls('assets').filter((f) => /^pdf\.worker.*\.mjs$/.test(f)).length,
        font: ls('assets').filter((f) => /^NotoSans-Regular.*\.ttf$/.test(f)).length,
        cmaps: ls('pdfjs/cmaps').length,
        standardFonts: ls('pdfjs/standard_fonts').length,
        wasm: ls('pdfjs/wasm').filter((f) => f.endsWith('.wasm')),
      };
    });
    console.log('packaged assets:', JSON.stringify(assets));
    expect(assets.appPath).toMatch(/app\.asar$/);
    expect(assets.worker).toBe(1);
    expect(assets.font).toBe(1);
    expect(assets.cmaps).toBeGreaterThan(100);
    expect(assets.standardFonts).toBeGreaterThan(5);
    expect(assets.wasm).toEqual(
      expect.arrayContaining(['jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm']),
    );

    // 3. Offline proof. Record every request URL (and cancel network schemes, like the app does),
    //    then reload the window and open another PDF through the `open-file` path (Finder).
    await app.evaluate(({ session }) => {
      const g = globalThis as unknown as { __urls: string[] };
      g.__urls = [];
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) => {
        g.__urls.push(d.url);
        cb({ cancel: /^(https?|wss?|ftp):/i.test(d.url) });
      });
    });
    await page.reload();
    await app.evaluate(({ app: a }, p) => {
      a.emit('open-file', { preventDefault() {} }, p);
    }, FIX('large-50page.pdf'));
    await expect(page.getByText(/50/).first()).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => (await renderedPages(page)).inked, { timeout: 20_000 })
      .toBe(true);
    await page.waitForTimeout(1500);

    const urls = await app.evaluate(() => (globalThis as unknown as { __urls: string[] }).__urls);
    console.log(`recorded ${urls.length} requests; schemes:`, [
      ...new Set(urls.map((u) => u.split(':')[0])),
    ]);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((u) => /^(https?|wss?|ftp):/i.test(u))).toEqual([]);
    expect(urls.every((u) => /^(file|blob|data|devtools|chrome-extension):/i.test(u))).toBe(true);

    // 4. Page-level probe: an outbound request is refused in the packaged build.
    const blocked = await page.evaluate(() =>
      fetch('https://example.com/').then(
        () => 'reached',
        () => 'blocked',
      ),
    );
    expect(blocked).toBe('blocked');
  } finally {
    await app.close();
  }
});
