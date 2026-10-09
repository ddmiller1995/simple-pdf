// Helpers for the signature-extraction tests: decode PNG/JPEG fixtures to raw RGBA, load ground
// truth, and score an extraction result against it.
import { readFileSync } from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PNG } from 'pngjs';
import type { ExtractResult, RgbaImage } from '../../src/renderer/src/signature/extract';
import { fixturePath, loadPng, loadSigTruth } from './fixtures';

export type Truth = {
  width: number;
  height: number;
  bbox: { x: number; y: number; width: number; height: number };
  /** Fixture name of a PNG whose white pixels are certain ink (coverage >= 0.99). */
  mask: string;
};

/** Decode any PNG/JPEG fixture (or absolute path) to RGBA. */
export async function decodeImage(pathOrFixture: string): Promise<RgbaImage> {
  const path = pathOrFixture.startsWith('/') ? pathOrFixture : fixturePath(pathOrFixture);
  if (path.endsWith('.png')) return loadPng(pathOrFixture);
  const img = await loadImage(readFileSync(path));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height);
  return { data: new Uint8ClampedArray(d.data), width: d.width, height: d.height };
}

/** Ground truth for the four original T0 photos (shared stroke geometry, sig-truth.json). */
export function originalTruth(): Truth {
  const t = loadSigTruth();
  return { width: t.width, height: t.height, bbox: t.bbox, mask: 'sig-truth-mask.png' };
}

/** Ground truth for the T3 extra photos (sig-extra-truth.json), keyed by image file name. */
export function extraTruth(name: string): Truth {
  const all = JSON.parse(readFileSync(fixturePath('sig-extra-truth.json'), 'utf8')) as Record<
    string,
    Truth
  >;
  const t = all[name];
  if (!t) throw new Error(`no ground truth for ${name}`);
  return t;
}

/** Boolean mask of certain-ink pixels for a truth entry. */
export function loadMask(truth: Truth): Uint8Array {
  const png = PNG.sync.read(readFileSync(fixturePath(truth.mask)));
  const out = new Uint8Array(png.width * png.height);
  for (let i = 0; i < out.length; i++) out[i] = png.data[i * 4] > 127 ? 1 : 0;
  return out;
}

/** Square dilation of a boolean mask by `r` pixels (separable). */
export function dilateMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r) && !v; xx++)
        v = mask[y * w + xx];
      tmp[y * w + x] = v;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r) && !v; yy++)
        v = tmp[yy * w + x];
      out[y * w + x] = v;
    }
  }
  return out;
}

export type Score = {
  /** Share of non-ink pixels (outside the crop's dilated ink) with alpha === 0, 0..1. */
  backgroundTransparent: number;
  /** Share of certain-ink pixels with alpha >= 200, 0..1. */
  inkKept: number;
  /** Largest tight-bbox edge deviation from the truth, as a fraction of the truth width/height. */
  cropError: number;
};

/**
 * Score an extraction against ground truth. The comparison is done in source coordinates over the
 * crop rectangle (`result.bbox`); pixels outside the crop are cropped away and not counted as
 * background, so the background figure is the harder in-crop one.
 */
export function score(result: ExtractResult, truth: Truth, mask: Uint8Array): Score {
  const { width: sw, height: sh } = result.sourceSize;
  if (sw !== truth.width || sh !== truth.height) {
    throw new Error('score() needs an un-scaled extraction (source size must equal truth size)');
  }
  const near = dilateMask(mask, sw, sh, 8);
  const { bbox, imageData } = result;
  let bgTotal = 0,
    bgClear = 0,
    inkOpaque = 0;
  for (let y = 0; y < bbox.height; y++) {
    for (let x = 0; x < bbox.width; x++) {
      const si = (bbox.y + y) * sw + (bbox.x + x);
      const a = imageData.data[(y * bbox.width + x) * 4 + 3];
      if (mask[si]) {
        if (a >= 200) inkOpaque++;
      } else if (!near[si]) {
        bgTotal++;
        if (a === 0) bgClear++;
      }
    }
  }
  // Ink pixels outside the crop count as lost.
  let allInk = 0;
  for (let i = 0; i < mask.length; i++) allInk += mask[i];
  const ib = result.inkBbox;
  const tb = truth.bbox;
  const cropError = Math.max(
    Math.abs(ib.x - tb.x) / tb.width,
    Math.abs(ib.x + ib.width - (tb.x + tb.width)) / tb.width,
    Math.abs(ib.y - tb.y) / tb.height,
    Math.abs(ib.y + ib.height - (tb.y + tb.height)) / tb.height,
  );
  return {
    backgroundTransparent: bgTotal ? bgClear / bgTotal : 1,
    inkKept: allInk ? inkOpaque / allInk : 1,
    cropError,
  };
}
