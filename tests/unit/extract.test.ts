import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_EXTRACT_OPTIONS,
  NoInkError,
  applyExtraction,
  extractInk,
  prepareExtraction,
  type ExtractOptions,
  type RgbaImage,
} from '../../src/renderer/src/signature/extract';
import { fixturePath } from '../helpers/fixtures';
import {
  decodeImage,
  dilateMask,
  extraTruth,
  loadMask,
  originalTruth,
  score,
  type Score,
  type Truth,
} from '../helpers/sigFixtures';

const opts = (o: Partial<ExtractOptions> = {}): ExtractOptions => ({
  ...DEFAULT_EXTRACT_OPTIONS,
  ...o,
});

const CASES: [file: string, truth: () => Truth][] = [
  ['sig-clean.png', originalTruth],
  ['sig-gradient-noise.png', originalTruth],
  ['sig-lined.png', originalTruth],
  ['sig-blue.png', originalTruth],
  ['sig-cursive.png', () => extraTruth('sig-cursive.png')],
  ['sig-phone.jpg', () => extraTruth('sig-phone.jpg')],
  ['sig-jpeg-heavy.jpg', () => extraTruth('sig-jpeg-heavy.jpg')],
  ['sig-initials.png', () => extraTruth('sig-initials.png')],
  ['sig-flourish.png', () => extraTruth('sig-flourish.png')],
];

const metrics: Record<string, Score & { ms: number }> = {};

afterAll(() => {
  const rows = Object.entries(metrics).map(
    ([name, m]) =>
      `${name.padEnd(24)} bg-transparent ${(m.backgroundTransparent * 100).toFixed(2)}%  ink-kept ${(m.inkKept * 100).toFixed(2)}%  crop-err ${(m.cropError * 100).toFixed(2)}%  ${m.ms.toFixed(0)}ms`,
  );
  console.log('\nextraction metrics (default options)\n' + rows.join('\n'));
});

describe('extractInk on synthetic photos', () => {
  it.each(CASES)('%s: background transparent, ink kept, tight crop', async (file, getTruth) => {
    const truth = getTruth();
    const img = await decodeImage(file);
    expect([img.width, img.height]).toEqual([truth.width, truth.height]);
    const t0 = performance.now();
    const result = extractInk(img, opts());
    const ms = performance.now() - t0;
    const s = score(result, truth, loadMask(truth));
    metrics[file] = { ...s, ms };
    expect(s.backgroundTransparent).toBeGreaterThan(0.99);
    expect(s.inkKept).toBeGreaterThan(0.95);
    expect(s.cropError).toBeLessThanOrEqual(0.05);
    // Padding: the crop is the ink bbox grown by ~4% per side.
    expect(result.bbox.width).toBeGreaterThan(result.inkBbox.width);
    expect(result.bbox.width).toBeLessThanOrEqual(result.inkBbox.width * 1.1);
    expect(result.imageData.width).toBe(result.bbox.width);
    expect(result.imageData.height).toBe(result.bbox.height);
  });

  it('keeps small marks (i-dot) that sit inside the signature', async () => {
    const truth = extraTruth('sig-cursive.png');
    const img = await decodeImage('sig-cursive.png');
    const result = extractInk(img, opts());
    // The i-dot is centred near (640, 215) and is far smaller than the 0.02% area rule.
    const x = 640 - result.bbox.x;
    const y = 215 - result.bbox.y;
    let opaque = 0;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (result.imageData.data[((y + dy) * result.bbox.width + (x + dx)) * 4 + 3] > 200)
          opaque++;
      }
    }
    expect(opaque).toBeGreaterThan(10);
    expect(truth.bbox.width).toBeGreaterThan(0);
  });
});

describe('colours', () => {
  it('black ink is #111 with soft alpha edges', async () => {
    const r = extractInk(await decodeImage('sig-gradient-noise.png'), opts({ color: 'black' }));
    const d = r.imageData.data;
    let partial = 0;
    for (let i = 0; i < d.length; i += 4) {
      expect([d[i], d[i + 1], d[i + 2]]).toEqual([0x11, 0x11, 0x11]);
      if (d[i + 3] > 0 && d[i + 3] < 255) partial++;
    }
    expect(partial).toBeGreaterThan(100); // anti-aliased edges survive
  });

  it('blue ink is #1a3d8f', async () => {
    const r = extractInk(await decodeImage('sig-clean.png'), opts({ color: 'blue' }));
    expect([...r.imageData.data.slice(0, 3)]).toEqual([0x1a, 0x3d, 0x8f]);
  });

  it('original keeps the (blue) source ink colour', async () => {
    const r = extractInk(await decodeImage('sig-blue.png'), opts({ color: 'original' }));
    const d = r.imageData.data;
    let n = 0,
      blueish = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 255) {
        n++;
        if (d[i + 2] > d[i] + 40) blueish++;
      }
    }
    expect(n).toBeGreaterThan(1000);
    expect(blueish / n).toBeGreaterThan(0.95);
  });
});

describe('sensitivity', () => {
  it('higher sensitivity keeps more ink; lower keeps less', async () => {
    const prep = prepareExtraction(await decodeImage('sig-gradient-noise.png'));
    const inkPixels = (sensitivity: number): number => {
      const r = applyExtraction(prep, opts({ sensitivity }));
      let n = 0;
      for (let i = 3; i < r.imageData.data.length; i += 4) n += r.imageData.data[i] / 255;
      return n;
    };
    const lo = inkPixels(-0.2);
    const mid = inkPixels(0);
    const hi = inkPixels(0.2);
    expect(lo).toBeLessThan(mid);
    expect(mid).toBeLessThan(hi);
  });

  it('clamps out-of-range sensitivity', async () => {
    const prep = prepareExtraction(await decodeImage('sig-clean.png'));
    const a = applyExtraction(prep, opts({ sensitivity: 5 }));
    const b = applyExtraction(prep, opts({ sensitivity: 0.2 }));
    expect(a.threshold).toBe(b.threshold);
  });
});

describe('errors and edge cases', () => {
  it('throws NoInkError on a blank page', () => {
    const w = 400,
      h = 300;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    expect(() => extractInk({ data, width: w, height: h }, opts())).toThrow(NoInkError);
  });

  it('treats transparent pixels as paper (transparent PNG input)', async () => {
    const src = await decodeImage('sig-clean.png');
    // Make everything the ink does not cover fully transparent.
    const data = new Uint8ClampedArray(src.data);
    for (let i = 0; i < data.length; i += 4) {
      const ink = data[i] < 128;
      data[i + 3] = ink ? 255 : 0;
    }
    const r = extractInk({ data, width: src.width, height: src.height }, opts());
    const tb = originalTruth().bbox;
    expect(Math.abs(r.inkBbox.x - tb.x)).toBeLessThan(tb.width * 0.05);
  });

  it('downscales inputs larger than 2000px on the long edge', async () => {
    const src = await decodeImage('sig-clean.png');
    const big = resample(src, 3000, 1500);
    const r = extractInk(big, opts());
    expect(r.sourceSize).toEqual({ width: 2000, height: 1000 });
    const tb = originalTruth().bbox;
    const s = 2000 / 1200;
    expect(Math.abs(r.inkBbox.x - tb.x * s)).toBeLessThan(tb.width * s * 0.05);
    expect(Math.abs(r.inkBbox.width - tb.width * s)).toBeLessThan(tb.width * s * 0.05);
  });
});

/** Nearest-neighbour resample (test helper). */
function resample(src: RgbaImage, w: number, h: number): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / w));
      const si = (sy * src.width + sx) * 4;
      const di = (y * w + x) * 4;
      data[di] = src.data[si];
      data[di + 1] = src.data[si + 1];
      data[di + 2] = src.data[si + 2];
      data[di + 3] = src.data[si + 3];
    }
  }
  return { data, width: w, height: h };
}

describe('ruled lines', () => {
  /** Share of `rows` pixels, away from the ink, that are not transparent. */
  function lineResidue(
    r: ReturnType<typeof extractInk>,
    rows: number[],
    mask: Uint8Array,
    w: number,
    h: number,
  ): number {
    const near = dilateMask(mask, w, h, 8);
    let total = 0,
      opaque = 0;
    for (const row of rows) {
      for (let yy = row - 2; yy <= row + 2; yy++) {
        for (let x = 0; x < r.bbox.width; x++) {
          const sy = yy;
          const sx = r.bbox.x + x;
          const y = sy - r.bbox.y;
          if (y < 0 || y >= r.bbox.height || near[sy * w + sx]) continue;
          total++;
          if (r.imageData.data[(y * r.bbox.width + x) * 4 + 3] > 0) opaque++;
        }
      }
    }
    return total ? opaque / total : 0;
  }

  it('sig-lined.png: faint lines are gone at default sensitivity, Remove lines clears them at +0.2', async () => {
    const truth = originalTruth();
    const mask = loadMask(truth);
    const img = await decodeImage('sig-lined.png');
    const prep = prepareExtraction(img);
    const rows = [...Array(9).keys()].map((i) => (i + 1) * 60);

    const normal = applyExtraction(prep, opts());
    expect(lineResidue(normal, rows, mask, img.width, img.height)).toBeLessThan(0.01);

    const withLines = applyExtraction(prep, opts({ sensitivity: 0.2 }));
    // Without the option the lines do show up at this sensitivity (so the check below is meaningful).
    expect(lineResidue(withLines, rows, mask, img.width, img.height)).toBeGreaterThan(0.3);
    const removed = applyExtraction(prep, opts({ sensitivity: 0.2, removeLines: true }));
    expect(lineResidue(removed, rows, mask, img.width, img.height)).toBeLessThan(0.01);
    // And the crop is tight again.
    const tb = truth.bbox;
    expect(Math.abs(removed.inkBbox.width - tb.width) / tb.width).toBeLessThanOrEqual(0.05);
    expect(withLines.inkBbox.width).toBeGreaterThanOrEqual(removed.inkBbox.width);
  });

  it('dark ruled lines through the signature are removed, the signature stays', async () => {
    const truth = originalTruth();
    const mask = loadMask(truth);
    const src = await decodeImage('sig-clean.png');
    const data = new Uint8ClampedArray(src.data);
    const rows = [...Array(9).keys()].map((i) => (i + 1) * 60);
    for (const row of rows) {
      for (let y = row - 1; y <= row; y++) {
        for (let x = 0; x < src.width; x++) {
          const i = (y * src.width + x) * 4;
          if (data[i] > 90) data[i] = data[i + 1] = data[i + 2] = 90; // dark grey line, under the ink
        }
      }
    }
    const img = { data, width: src.width, height: src.height };
    const kept = extractInk(img, opts());
    expect(kept.inkBbox.width).toBeGreaterThan(src.width * 0.95); // lines included: full width

    const removed = extractInk(img, opts({ removeLines: true }));
    expect(lineResidue(removed, rows, mask, img.width, img.height)).toBeLessThan(0.01);
    const s = score(removed, truth, mask);
    expect(s.cropError).toBeLessThanOrEqual(0.05);
    expect(s.inkKept).toBeGreaterThan(0.95);
    expect(s.backgroundTransparent).toBeGreaterThan(0.99);
  });

  it('Remove lines leaves a signature without lines untouched', async () => {
    const img = await decodeImage('sig-gradient-noise.png');
    const prep = prepareExtraction(img);
    const a = applyExtraction(prep, opts());
    const b = applyExtraction(prep, opts({ removeLines: true }));
    expect(b.inkBbox).toEqual(a.inkBbox);
    const truth = originalTruth();
    const s = score(b, truth, loadMask(truth));
    expect(s.inkKept).toBeGreaterThan(0.95);
  });
});

const removeLinesMetrics: Record<string, Score> = {};
afterAll(() => {
  const rows = Object.entries(removeLinesMetrics).map(
    ([name, m]) =>
      `${name.padEnd(24)} bg-transparent ${(m.backgroundTransparent * 100).toFixed(2)}%  ink-kept ${(m.inkKept * 100).toFixed(2)}%  crop-err ${(m.cropError * 100).toFixed(2)}%`,
  );
  console.log('\nextraction metrics (Remove lines ON)\n' + rows.join('\n'));
});

describe('Remove lines never damages ink', () => {
  it.each([
    ...CASES,
    ['sig-flourish-lined.png', () => extraTruth('sig-flourish-lined.png')] as [string, () => Truth],
  ])('%s: ink kept >= 98% with Remove lines on', async (file, getTruth) => {
    const truth = getTruth();
    const result = extractInk(await decodeImage(file), opts({ removeLines: true }));
    const s = score(result, truth, loadMask(truth));
    removeLinesMetrics[file] = s;
    expect(s.inkKept).toBeGreaterThanOrEqual(0.98);
    expect(s.cropError).toBeLessThanOrEqual(0.05);
    expect(s.backgroundTransparent).toBeGreaterThan(0.99);
  });

  it('long curved flourishes (>= 40% of the ink width) are identical with and without Remove lines', async () => {
    const truth = extraTruth('sig-flourish.png');
    expect(truth.bbox.width).toBeGreaterThan(600);
    const prep = prepareExtraction(await decodeImage('sig-flourish.png'));
    const a = applyExtraction(prep, opts());
    const b = applyExtraction(prep, opts({ removeLines: true }));
    expect(b.imageData.data).toEqual(a.imageData.data);
  });

  it('sig-flourish-lined.png: ruled lines show without the option and are removed with it', async () => {
    const truth = extraTruth('sig-flourish-lined.png');
    const mask = loadMask(truth);
    const img = await decodeImage('sig-flourish-lined.png');
    const prep = prepareExtraction(img);
    const slope = Math.tan((0.6 * Math.PI) / 180);
    const near = dilateMask(mask, img.width, img.height, 8);
    const residue = (r: ReturnType<typeof extractInk>): number => {
      let total = 0,
        opaque = 0;
      for (let k = 1; k <= 9; k++) {
        for (let x = 0; x < r.bbox.width; x++) {
          const sx = r.bbox.x + x;
          const sy = Math.round(60 * k + sx * slope);
          const y = sy - r.bbox.y;
          if (y < 0 || y >= r.bbox.height || near[sy * img.width + sx]) continue;
          total++;
          if (r.imageData.data[(y * r.bbox.width + x) * 4 + 3] > 0) opaque++;
        }
      }
      return total ? opaque / total : 0;
    };
    const kept = applyExtraction(prep, opts());
    expect(kept.inkBbox.width).toBeGreaterThan(img.width * 0.95); // lines widen the crop
    expect(residue(kept)).toBeGreaterThan(0.5);

    const removed = applyExtraction(prep, opts({ removeLines: true }));
    expect(residue(removed)).toBeLessThan(0.01);
    const s = score(removed, truth, mask);
    expect(s.inkKept).toBeGreaterThanOrEqual(0.98);
    expect(s.cropError).toBeLessThanOrEqual(0.05);
    expect(s.backgroundTransparent).toBeGreaterThan(0.99);
  });
});

describe('performance', () => {
  it('extracts a 2000px photo in under 300 ms', async () => {
    const src = await decodeImage('sig-gradient-noise.png');
    const img = resample(src, 2000, 1000);
    extractInk(img, opts()); // warm up the JIT
    const times: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      extractInk(img, opts({ removeLines: true }));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    console.log(
      `extractInk 2000x1000 (with Remove lines): median ${median.toFixed(0)} ms, min ${times[0].toFixed(0)} ms, max ${times[times.length - 1].toFixed(0)} ms`,
    );
    expect(median).toBeLessThan(300);

    // Live preview path: re-applying options on a prepared image is much cheaper.
    const prep = prepareExtraction(img);
    const t0 = performance.now();
    applyExtraction(prep, opts({ sensitivity: 0.05 }));
    console.log(`applyExtraction (prepared) 2000x1000: ${(performance.now() - t0).toFixed(0)} ms`);
  });
});

// Personal photo: never committed, so this only runs on the author's machine.
const REAL = fixturePath('real-signature.jpg');
describe.skipIf(!existsSync(REAL))('real-signature.jpg (manual check)', () => {
  it('extracts ink and prints coverage stats', async () => {
    const img = await decodeImage(REAL);
    for (const removeLines of [false, true]) {
      const t0 = performance.now();
      const r = extractInk(img, opts({ removeLines }));
      const ms = performance.now() - t0;
      let ink = 0;
      for (let i = 3; i < r.imageData.data.length; i += 4) if (r.imageData.data[i] > 127) ink++;
      const total = r.imageData.width * r.imageData.height;
      const src = r.sourceSize;
      console.log(
        `real-signature.jpg ${img.width}x${img.height} -> ${src.width}x${src.height}, removeLines=${removeLines}: ` +
          `threshold ${r.threshold.toFixed(3)}, ink bbox ${r.inkBbox.width}x${r.inkBbox.height} ` +
          `(${((r.inkBbox.width * r.inkBbox.height * 100) / (src.width * src.height)).toFixed(1)}% of frame), ` +
          `opaque ${((ink * 100) / total).toFixed(1)}% of crop, ${ms.toFixed(0)} ms`,
      );
      expect(r.imageData.width).toBeGreaterThan(10);
      // Manual visual check: SIG_PREVIEW_DIR=<dir> writes the result composited on light grey.
      const outDir = process.env['SIG_PREVIEW_DIR'];
      if (outDir) {
        const { width, height, data } = r.imageData;
        const png = new PNG({ width, height });
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3]! / 255;
          for (let c = 0; c < 3; c++)
            png.data[i + c] = Math.round(data[i + c]! * a + 220 * (1 - a));
          png.data[i + 3] = 255;
        }
        writeFileSync(join(outDir, `real-signature-lines-${removeLines}.png`), PNG.sync.write(png));
      }
    }
  });
});
