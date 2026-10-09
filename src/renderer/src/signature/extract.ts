// Photo -> transparent, cropped ink. Pure: operates on raw RGBA, no DOM (runs under Vitest in Node).
// Algorithm: IMPLEMENTATION_PLAN.md section 6 / T3.
//
//   downscale (long edge <= 2000) -> luminance -> flat-field (estimate the paper illumination, divide
//   it out) -> Otsu threshold (+ user sensitivity) -> soft alpha -> optional ruled-line removal ->
//   despeckle -> crop (+4% padding) -> recolor.
//
// For live preview, split the work: `prepareExtraction` does the expensive, option-independent part
// once per photo; `applyExtraction` is called for every slider/colour change.

export type RgbaImage = { data: Uint8ClampedArray; width: number; height: number };

export type InkColor = 'black' | 'blue' | 'original';

export type ExtractOptions = {
  sensitivity: number; // -0.2 .. +0.2 offset applied to the Otsu threshold (positive = more ink)
  color: InkColor;
  removeLines: boolean;
};

export type Rect = { x: number; y: number; width: number; height: number };

export type ExtractResult = {
  /** The cropped, recoloured RGBA result (non-premultiplied; transparent outside the ink). */
  imageData: RgbaImage;
  /** Crop rectangle (ink bbox plus padding) in the coordinates of the possibly-downscaled input. */
  bbox: Rect;
  /** Tight ink bounding box (no padding), same coordinates as `bbox`. */
  inkBbox: Rect;
  /** Threshold on the flat-fielded luminance (0..1) that was used: Otsu + sensitivity. */
  threshold: number;
  /** Size of the (possibly downscaled) image that `bbox` refers to. */
  sourceSize: { width: number; height: number };
};

export const DEFAULT_EXTRACT_OPTIONS: ExtractOptions = {
  sensitivity: 0,
  color: 'black',
  removeLines: false,
};

export const MAX_EDGE = 2000;
export const SENSITIVITY_RANGE = 0.2;

/** Ink colours for the recolor step. */
export const INK_RGB: Record<Exclude<InkColor, 'original'>, [number, number, number]> = {
  black: [0x11, 0x11, 0x11],
  blue: [0x1a, 0x3d, 0x8f],
};

export class NoInkError extends Error {
  constructor() {
    super('No ink found in this image. Try raising the sensitivity or use a clearer photo.');
    this.name = 'NoInkError';
  }
}

/** Half-width of the alpha ramp around the threshold (in flat-fielded luminance units). */
const SOFT_EDGE = 0.05;
const PAD_FRACTION = 0.04;

// ---------------------------------------------------------------------------------------------
// Preparation (option independent)
// ---------------------------------------------------------------------------------------------

export type Prepared = {
  width: number;
  height: number;
  /** Source pixels after (optional) downscaling, composited over white. */
  rgba: Uint8ClampedArray;
  /** Flat-fielded luminance in 0..1: ~1 on paper, low on ink. */
  norm: Float32Array;
  /** Illumination estimate (0..1) used for the flat-field. */
  background: Float32Array;
  /** Otsu's threshold before refinement. */
  otsu: number;
  /** Default threshold: Otsu refined to the half-coverage level between ink and paper. */
  baseThreshold: number;
};

/** Area-average downscale so that the long edge is at most `maxEdge`. Returns the input if small enough. */
export function downscale(input: RgbaImage, maxEdge: number = MAX_EDGE): RgbaImage {
  const { width: sw, height: sh, data } = input;
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  if (scale >= 1) return input;
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const out = new Uint8ClampedArray(dw * dh * 4);
  const xs = new Int32Array(dw + 1);
  const ys = new Int32Array(dh + 1);
  for (let i = 0; i <= dw; i++) xs[i] = Math.min(sw, Math.round((i * sw) / dw));
  for (let i = 0; i <= dh; i++) ys[i] = Math.min(sh, Math.round((i * sh) / dh));
  for (let y = 0; y < dh; y++) {
    const y0 = ys[y];
    const y1 = Math.max(y0 + 1, ys[y + 1]);
    for (let x = 0; x < dw; x++) {
      const x0 = xs[x];
      const x1 = Math.max(x0 + 1, xs[x + 1]);
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        n = 0;
      for (let yy = y0; yy < y1 && yy < sh; yy++) {
        for (let xx = x0; xx < x1 && xx < sw; xx++) {
          const i = (yy * sw + xx) * 4;
          const al = data[i + 3];
          // Alpha-weighted so that transparent pixels do not drag colours to black.
          r += data[i] * al;
          g += data[i + 1] * al;
          b += data[i + 2] * al;
          a += al;
          n++;
        }
      }
      const o = (y * dw + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = n ? a / n : 0;
    }
  }
  return { data: out, width: dw, height: dh };
}

/** Running-sum box blur along one axis with edge replication. Operates in place on `src` -> `dst`. */
function boxBlurAxis(
  src: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
  r: number,
  horizontal: boolean,
): void {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const stride = horizontal ? 1 : w;
  const lineStride = horizontal ? w : 1;
  const inv = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const base = l * lineStride;
    let sum = src[base] * (r + 1); // left replicate of index 0 (r copies) + index 0 itself
    for (let k = 1; k <= r; k++) sum += src[base + Math.min(len - 1, k) * stride];
    for (let i = 0; i < len; i++) {
      dst[base + i * stride] = sum * inv;
      const add = Math.min(len - 1, i + r + 1);
      const sub = Math.max(0, i - r);
      sum += src[base + add * stride] - src[base + sub * stride];
    }
  }
}

/** Three-pass separable box blur (~Gaussian). Returns a new array. */
function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src.slice();
  const a: Float32Array = src.slice();
  const b = new Float32Array(src.length);
  for (let pass = 0; pass < 3; pass++) {
    boxBlurAxis(a, b, w, h, r, true);
    boxBlurAxis(b, a, w, h, r, false);
  }
  return a;
}

/** Separable max filter (grayscale dilation) with a square window of radius r. */
function dilate(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src.slice();
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      for (let xx = x0; xx <= x1; xx++) m = Math.max(m, src[y * w + xx]);
      tmp[y * w + x] = m;
    }
  }
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let yy = y0; yy <= y1; yy++) m = Math.max(m, tmp[yy * w + x]);
      out[y * w + x] = m;
    }
  }
  return out;
}

/**
 * Estimate the paper illumination. Works on a coarse grid (block means), where a grey-scale closing
 * (max filter) erases the dark pen strokes, then a large three-pass box blur smooths it (radius ~
 * 1/16 of the short edge), then bilinear upsampling back to full resolution.
 */
function estimateBackground(lum: Float32Array, w: number, h: number): Float32Array {
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  const f = Math.max(1, Math.round(long / 400)); // cell size in px
  const cw = Math.ceil(w / f);
  const ch = Math.ceil(h / f);
  const coarse = new Float32Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) {
    const y0 = cy * f;
    const y1 = Math.min(h, y0 + f);
    for (let cx = 0; cx < cw; cx++) {
      const x0 = cx * f;
      const x1 = Math.min(w, x0 + f);
      let s = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += lum[y * w + x];
      coarse[cy * cw + cx] = s / ((y1 - y0) * (x1 - x0));
    }
  }
  // Strokes are at most ~1.2% of the long edge wide (half-width); the window must exceed that.
  const dilR = Math.max(1, Math.ceil((0.012 * long) / f));
  const closed = dilate(coarse, cw, ch, dilR);
  const smooth = blur(closed, cw, ch, Math.max(1, Math.round(short / 16 / f)));

  // Bilinear upsample (cell centres at (i + 0.5) * f).
  const out = new Float32Array(w * h);
  const x0s = new Int32Array(w);
  const x1s = new Int32Array(w);
  const wxs = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const g = Math.min(cw - 1, Math.max(0, (x + 0.5) / f - 0.5));
    const i0 = Math.floor(g);
    x0s[x] = i0;
    x1s[x] = Math.min(cw - 1, i0 + 1);
    wxs[x] = g - i0;
  }
  for (let y = 0; y < h; y++) {
    const g = Math.min(ch - 1, Math.max(0, (y + 0.5) / f - 0.5));
    const j0 = Math.floor(g);
    const j1 = Math.min(ch - 1, j0 + 1);
    const wy = g - j0;
    const r0 = j0 * cw;
    const r1 = j1 * cw;
    for (let x = 0; x < w; x++) {
      const a = smooth[r0 + x0s[x]] * (1 - wxs[x]) + smooth[r0 + x1s[x]] * wxs[x];
      const b = smooth[r1 + x0s[x]] * (1 - wxs[x]) + smooth[r1 + x1s[x]] * wxs[x];
      out[y * w + x] = a * (1 - wy) + b * wy;
    }
  }
  return out;
}

/** Otsu's threshold on values in 0..1 (256 bins). */
function otsu(values: Float32Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < values.length; i++) {
    hist[Math.min(255, Math.max(0, Math.floor(values[i] * 255.999)))]++;
  }
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let wB = 0,
    sumB = 0,
    best = -1,
    bestT = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestT = t;
    }
  }
  // `bestT` is the last bin of the dark class; the cut sits at its upper edge.
  return (bestT + 1) / 256;
}

/**
 * Otsu is biased towards the (huge) paper class when ink is sparse, which makes strokes come out
 * bolder than the pen drew them. Refine it: take the mean level of the core ink and of the paper and
 * cut halfway between them, which is where a pen edge is 50% covered.
 */
function halfCoverageThreshold(norm: Float32Array, t0: number): number {
  let inkSum = 0,
    inkN = 0,
    paperSum = 0,
    paperN = 0;
  for (let i = 0; i < norm.length; i++) {
    const v = norm[i];
    if (v < t0 * 0.6) {
      inkSum += v;
      inkN++;
    } else if (v >= t0) {
      paperSum += v;
      paperN++;
    }
  }
  if (inkN === 0 || paperN === 0) return t0;
  const mid = (inkSum / inkN + paperSum / paperN) / 2;
  // Never above Otsu's answer, which is the better judge on clean, well-separated images.
  return Math.min(0.85, Math.max(0.25, Math.min(t0, mid)));
}

/** Downscale, compute luminance, flat-field and the Otsu threshold. The expensive, option-free part. */
export function prepareExtraction(input: RgbaImage, maxEdge: number = MAX_EDGE): Prepared {
  const img = downscale(input, maxEdge);
  const { width: w, height: h } = img;
  const n = w * h;
  const rgba = new Uint8ClampedArray(n * 4);
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const a = img.data[o + 3] / 255;
    // Composite over white so transparent PNG pixels count as paper.
    const r = img.data[o] * a + 255 * (1 - a);
    const g = img.data[o + 1] * a + 255 * (1 - a);
    const b = img.data[o + 2] * a + 255 * (1 - a);
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = 255;
    lum[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; // Rec. 709
  }
  const background = estimateBackground(lum, w, h);
  const norm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    norm[i] = Math.min(1, lum[i] / Math.max(0.05, background[i]));
  }
  // Keep Otsu away from degenerate answers on near-blank or very noisy images.
  const t0 = Math.min(0.85, Math.max(0.25, otsu(norm)));
  return {
    width: w,
    height: h,
    rgba,
    norm,
    background,
    otsu: t0,
    baseThreshold: halfCoverageThreshold(norm, t0),
  };
}

// ---------------------------------------------------------------------------------------------
// Option dependent steps
// ---------------------------------------------------------------------------------------------

/**
 * Remove ruled lines: pixels that belong to a long horizontal run (>= 10% of the width, tolerating
 * 2px gaps and slight tilt) AND whose vertical run is thin. A pen stroke crossing a line makes the
 * vertical run long, so strokes (and the line pixels sharing their columns) survive.
 */
function removeRuledLines(alpha: Float32Array, w: number, h: number): void {
  const long = Math.max(w, h);
  const minRun = Math.max(8, Math.round(0.1 * w));
  const maxThickness = Math.max(3, Math.round(0.006 * long));
  const GAP = 2;

  // Vertical run length containing each ink pixel: count down the column, then spread the total
  // back up the run.
  const vlen = new Uint16Array(w * h);
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y < h; y++) {
      if (alpha[y * w + x] > 0) vlen[y * w + x] = ++run;
      else run = 0;
    }
    let full = 0;
    for (let y = h - 1; y >= 0; y--) {
      const i = y * w + x;
      if (alpha[i] > 0) {
        if (full === 0) full = vlen[i];
        vlen[i] = full;
      } else full = 0;
    }
  }

  const remove = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let x = 0;
    while (x < w) {
      if (!(alpha[row + x] > 0)) {
        x++;
        continue;
      }
      // Grow a run, merging gaps of up to GAP pixels.
      const start = x;
      let end = x;
      let gap = 0;
      let xx = x + 1;
      while (xx < w && gap <= GAP) {
        if (alpha[row + xx] > 0) {
          end = xx;
          gap = 0;
        } else gap++;
        xx++;
      }
      if (end - start + 1 >= minRun) {
        for (let k = start; k <= end; k++) {
          if (alpha[row + k] > 0 && vlen[row + k] <= maxThickness) remove[row + k] = 1;
        }
      }
      x = end + 1;
    }
  }
  for (let i = 0; i < alpha.length; i++) if (remove[i]) alpha[i] = 0;
}

/**
 * Drop connected components (8-neighbourhood) of non-zero alpha that are too small to be ink.
 * Small components (i-dots, full stops) that sit next to the main body of the signature are kept
 * under a relaxed size limit.
 */
function despeckle(alpha: Float32Array, w: number, h: number): void {
  const n = w * h;
  const area = n;
  const long = Math.max(w, h);
  const strictMin = Math.max(20, Math.round(0.0002 * area));
  const relaxedMin = Math.max(20, Math.round(0.00004 * area));
  const labels = new Int32Array(n); // 0 = unvisited/background
  const stack = new Int32Array(n);
  type Comp = { id: number; size: number; x0: number; y0: number; x1: number; y1: number };
  const comps: Comp[] = [];
  for (let start = 0; start < n; start++) {
    if (!(alpha[start] > 0) || labels[start] !== 0) continue;
    const id = comps.length + 1;
    const c: Comp = { id, size: 0, x0: w, y0: h, x1: -1, y1: -1 };
    let sp = 0;
    stack[sp++] = start;
    labels[start] = id;
    while (sp > 0) {
      const p = stack[--sp];
      const px = p % w;
      const py = (p - px) / w;
      c.size++;
      if (px < c.x0) c.x0 = px;
      if (px > c.x1) c.x1 = px;
      if (py < c.y0) c.y0 = py;
      if (py > c.y1) c.y1 = py;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= w || (dx === 0 && dy === 0)) continue;
          const q = ny * w + nx;
          if (alpha[q] > 0 && labels[q] === 0) {
            labels[q] = id;
            stack[sp++] = q;
          }
        }
      }
    }
    comps.push(c);
  }
  // Anchor region: the bounding boxes of large components, grown a little.
  const grow = Math.round(0.02 * long);
  const anchors = comps.filter((c) => c.size >= strictMin);
  const keep = new Uint8Array(comps.length + 1);
  for (const c of comps) {
    if (c.size >= strictMin) keep[c.id] = 1;
    else if (c.size >= relaxedMin) {
      const cx = (c.x0 + c.x1) / 2;
      const cy = (c.y0 + c.y1) / 2;
      if (
        anchors.some(
          (a) => cx >= a.x0 - grow && cx <= a.x1 + grow && cy >= a.y0 - grow && cy <= a.y1 + grow,
        )
      ) {
        keep[c.id] = 1;
      }
    }
  }
  for (let i = 0; i < n; i++) if (labels[i] !== 0 && !keep[labels[i]]) alpha[i] = 0;
}

/** Apply threshold, line removal, despeckle, crop and recolor to a prepared image. */
export function applyExtraction(prep: Prepared, options: ExtractOptions): ExtractResult {
  const { width: w, height: h, norm } = prep;
  const sens = Math.max(-SENSITIVITY_RANGE, Math.min(SENSITIVITY_RANGE, options.sensitivity));
  const threshold = prep.baseThreshold + sens;
  const n = w * h;

  // Soft alpha: linear ramp over +/- SOFT_EDGE around the threshold.
  const alpha = new Float32Array(n);
  const inv = 1 / (2 * SOFT_EDGE);
  for (let i = 0; i < n; i++) {
    const a = 0.5 + (threshold - norm[i]) * inv;
    alpha[i] = a <= 0 ? 0 : a >= 1 ? 1 : a;
  }

  if (options.removeLines) removeRuledLines(alpha, w, h);
  despeckle(alpha, w, h);

  // Tight bounding box of what is left.
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (alpha[row + x] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new NoInkError();
  const inkBbox: Rect = { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  const padX = Math.round(inkBbox.width * PAD_FRACTION);
  const padY = Math.round(inkBbox.height * PAD_FRACTION);
  const cx0 = Math.max(0, x0 - padX);
  const cy0 = Math.max(0, y0 - padY);
  const cx1 = Math.min(w - 1, x1 + padX);
  const cy1 = Math.min(h - 1, y1 + padY);
  const bbox: Rect = { x: cx0, y: cy0, width: cx1 - cx0 + 1, height: cy1 - cy0 + 1 };

  // Recolor + write the cropped RGBA.
  const out = new Uint8ClampedArray(bbox.width * bbox.height * 4);
  const fixed = options.color === 'original' ? null : INK_RGB[options.color];
  for (let y = 0; y < bbox.height; y++) {
    for (let x = 0; x < bbox.width; x++) {
      const si = (bbox.y + y) * w + (bbox.x + x);
      const o = (y * bbox.width + x) * 4;
      if (fixed) {
        out[o] = fixed[0];
        out[o + 1] = fixed[1];
        out[o + 2] = fixed[2];
      } else {
        // Divide out the lighting so ink in a shadow does not come out darker than elsewhere.
        const k = 1 / Math.max(0.35, prep.background[si]);
        out[o] = prep.rgba[si * 4] * k;
        out[o + 1] = prep.rgba[si * 4 + 1] * k;
        out[o + 2] = prep.rgba[si * 4 + 2] * k;
      }
      out[o + 3] = Math.round(alpha[si] * 255);
    }
  }
  return {
    imageData: { data: out, width: bbox.width, height: bbox.height },
    bbox,
    inkBbox,
    threshold,
    sourceSize: { width: w, height: h },
  };
}

/** One-shot extraction: `applyExtraction(prepareExtraction(input), options)`. */
export function extractInk(input: RgbaImage, options: ExtractOptions): ExtractResult {
  return applyExtraction(prepareExtraction(input), options);
}
