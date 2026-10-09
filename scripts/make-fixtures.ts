/**
 * Generates the test fixtures in tests/fixtures/ (PDFs + synthetic signature photos).
 * Run with `pnpm fixtures`. The generated files are committed; regenerate only when this script
 * changes. Output is deterministic (fixed dates, seeded PRNG) except encrypted PDFs, which use
 * random IVs/salts by design.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFPage, StandardFonts, degrees, rgb, type PDFFont } from '@cantoo/pdf-lib';
import { PNG } from 'pngjs';
import { ImageData, createCanvas } from '@napi-rs/canvas';

const OUT = join(__dirname, '..', 'tests', 'fixtures');
mkdirSync(OUT, { recursive: true });

const FIXED_DATE = new Date('2024-01-01T00:00:00Z');
const LETTER: [number, number] = [612, 792];
const A4: [number, number] = [595.28, 841.89];

async function newDoc(title: string): Promise<{ doc: PDFDocument; font: PDFFont; bold: PDFFont }> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(title);
  doc.setCreator('simple-pdf fixtures');
  doc.setProducer('simple-pdf fixtures');
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, font, bold };
}

function save(name: string, bytes: Uint8Array): void {
  writeFileSync(join(OUT, name), bytes);
  console.log(`wrote ${name} (${(bytes.length / 1024).toFixed(1)} KB)`);
}

function label(page: PDFPage, font: PDFFont, text: string, x: number, y: number, size = 12): void {
  page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) });
}

const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';

function bodyText(page: PDFPage, font: PDFFont, topY: number, lines: number): void {
  for (let i = 0; i < lines; i++) {
    label(page, font, LOREM.slice(0, 70 + ((i * 7) % 40)), 72, topY - i * 16, 11);
  }
}

// ---------------------------------------------------------------------------------------------
// PDFs
// ---------------------------------------------------------------------------------------------

async function simple3Page(): Promise<void> {
  const { doc, font, bold } = await newDoc('simple-3page');
  for (let i = 1; i <= 3; i++) {
    const page = doc.addPage(LETTER);
    label(page, bold, `Simple Page ${i} of 3`, 72, 720, 24);
    bodyText(page, font, 680, 20);
  }
  save('simple-3page.pdf', await doc.save());
}

async function mixedSizes(): Promise<void> {
  const { doc, font, bold } = await newDoc('mixed-sizes');
  const specs: [string, [number, number]][] = [
    ['Letter portrait 612x792', LETTER],
    ['A4 portrait 595.28x841.89', A4],
    ['Letter landscape 792x612', [792, 612]],
  ];
  for (const [name, size] of specs) {
    const page = doc.addPage(size);
    const [w, h] = size;
    label(page, bold, name, 48, h - 60, 22);
    page.drawRectangle({
      x: 20,
      y: 20,
      width: w - 40,
      height: h - 40,
      borderWidth: 1,
      borderColor: rgb(0.2, 0.2, 0.8),
    });
    bodyText(page, font, h - 100, 10);
  }
  save('mixed-sizes.pdf', await doc.save());
}

/**
 * Each page is Letter with /Rotate = 0/90/180/270. A red 50x50 marker square sits at the
 * unrotated TOP-LEFT corner: rect x=20..70, y=(792-70)..(792-20) in unrotated user space.
 * Visually the marker appears at: R0 top-left, R90 top-right, R180 bottom-right, R270 bottom-left.
 */
async function rotated(): Promise<void> {
  const { doc, font, bold } = await newDoc('rotated');
  for (const rot of [0, 90, 180, 270]) {
    const page = doc.addPage(LETTER);
    page.setRotation(degrees(rot));
    page.drawRectangle({ x: 20, y: 722, width: 50, height: 50, color: rgb(0.85, 0.1, 0.1) });
    label(page, bold, `MARKER rot=${rot}`, 80, 740, 14);
    label(page, bold, `ROTATE ${rot}`, 200, 400, 36);
    label(page, font, 'Upright text reads normally in the rotated view.', 120, 360, 12);
  }
  save('rotated.pdf', await doc.save());
}

/**
 * MediaBox [0 0 612 792], CropBox [50 100 450 600] (400x500). A red 40x40 marker sits at the
 * CropBox bottom-left corner (user space 50,100); text "CROPBOX HELLO" baseline is at (100,300).
 * "MEDIA ORIGIN" is at (10,10), outside the CropBox, so it must NOT be visible when rendered.
 */
async function cropboxOffset(): Promise<void> {
  const { doc, font, bold } = await newDoc('cropbox-offset');
  const page = doc.addPage(LETTER);
  page.setCropBox(50, 100, 400, 500);
  page.drawRectangle({
    x: 51,
    y: 101,
    width: 398,
    height: 498,
    borderWidth: 1,
    borderColor: rgb(0, 0.4, 0),
  });
  page.drawRectangle({ x: 50, y: 100, width: 40, height: 40, color: rgb(0.85, 0.1, 0.1) });
  label(page, bold, 'CROPBOX HELLO', 100, 300, 24);
  label(page, font, 'CROP ORIGIN (50,100)', 100, 120, 10);
  label(page, font, 'MEDIA ORIGIN', 10, 10, 10);
  save('cropbox-offset.pdf', await doc.save());
}

/**
 * Field names: fullName (text), notes (multiline text), agree (checkbox), color (radio: red,
 * green, blue), country (dropdown), interests (option list, multi-select).
 */
async function acroform(): Promise<void> {
  const { doc, font, bold } = await newDoc('acroform');
  const page = doc.addPage(LETTER);
  const form = doc.getForm();
  const border = { borderWidth: 1, borderColor: rgb(0.2, 0.2, 0.2) };
  label(page, bold, 'AcroForm test', 72, 720, 22);

  label(page, font, 'Full name', 72, 676);
  const fullName = form.createTextField('fullName');
  fullName.addToPage(page, { x: 72, y: 648, width: 250, height: 22, ...border });

  label(page, font, 'Notes', 72, 616);
  const notes = form.createTextField('notes');
  notes.enableMultiline();
  notes.addToPage(page, { x: 72, y: 528, width: 300, height: 80, ...border });

  label(page, font, 'I agree', 100, 500);
  const agree = form.createCheckBox('agree');
  agree.addToPage(page, { x: 72, y: 496, width: 18, height: 18, ...border });

  label(page, font, 'Favourite colour', 72, 464);
  const color = form.createRadioGroup('color');
  ['red', 'green', 'blue'].forEach((opt, i) => {
    const x = 72 + i * 90;
    color.addOptionToPage(opt, page, { x, y: 436, width: 16, height: 16, ...border });
    label(page, font, opt, x + 22, 440);
  });

  label(page, font, 'Country', 72, 404);
  const country = form.createDropdown('country');
  country.addOptions(['Australia', 'Brazil', 'Canada', 'Denmark']);
  country.addToPage(page, { x: 72, y: 376, width: 180, height: 22, ...border });

  label(page, font, 'Interests', 72, 344);
  const interests = form.createOptionList('interests');
  interests.addOptions(['Reading', 'Cycling', 'Cooking', 'Chess']);
  interests.enableMultiselect();
  interests.addToPage(page, { x: 72, y: 270, width: 180, height: 68, ...border });

  save('acroform.pdf', await doc.save());
}

/** Viewable PDF encrypted with an EMPTY user password + an owner password (AES-256). */
async function encrypted(): Promise<boolean> {
  try {
    const { doc, font, bold } = await newDoc('encrypted');
    const page = doc.addPage(LETTER);
    label(page, bold, 'Encrypted (owner-restricted) PDF', 72, 720, 20);
    label(page, font, 'Opens without a password; modifying is not permitted.', 72, 690);
    doc.encrypt({
      ownerPassword: 'owner-secret',
      userPassword: '',
      permissions: {
        printing: 'highResolution',
        modifying: false,
        copying: false,
        annotating: false,
      },
    });
    save('encrypted.pdf', await doc.save());

    const pw = await newDoc('encrypted-userpw');
    const p2 = pw.doc.addPage(LETTER);
    label(p2, pw.bold, 'Password-protected PDF (password: "secret")', 72, 720, 18);
    pw.doc.encrypt({ ownerPassword: 'owner-secret', userPassword: 'secret' });
    save('encrypted-userpw.pdf', await pw.doc.save());
    return true;
  } catch (e) {
    console.error('Could not create encrypted fixtures:', e);
    return false;
  }
}

async function large50(): Promise<void> {
  const { doc, font, bold } = await newDoc('large-50page');
  for (let i = 1; i <= 50; i++) {
    const page = doc.addPage(LETTER);
    label(page, bold, `Large Page ${i} of 50`, 72, 720, 24);
    bodyText(page, font, 680, 36);
    for (let k = 0; k < 12; k++) {
      page.drawRectangle({
        x: 72 + k * 40,
        y: 60,
        width: 30,
        height: 30 + ((i * 7 + k * 13) % 60),
        color: rgb(((i * 3 + k) % 10) / 10, ((i + k * 5) % 10) / 10, 0.6),
      });
    }
  }
  save('large-50page.pdf', await doc.save());
}

// ---------------------------------------------------------------------------------------------
// Synthetic signature photos
// ---------------------------------------------------------------------------------------------

const W = 1200;
const H = 600;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Stroke = { pts: [number, number][]; radius: number };

/** A cursive-looking scribble with a loop and an underline. Same strokes for every variant. */
function makeStrokes(): Stroke[] {
  const main: [number, number][] = [];
  for (let i = 0; i <= 600; i++) {
    const t = i / 600;
    main.push([160 + 820 * t, 290 + 110 * Math.sin(2 * Math.PI * 2.6 * t) * (1 - 0.35 * t)]);
  }
  const loop: [number, number][] = [];
  for (let i = 0; i <= 200; i++) {
    const a = (2 * Math.PI * i) / 200;
    loop.push([330 + 70 * Math.cos(a), 250 + 85 * Math.sin(a)]);
  }
  const underline: [number, number][] = [];
  for (let i = 0; i <= 300; i++) {
    const t = i / 300;
    underline.push([200 + 760 * t, 470 - 40 * t + 8 * Math.sin(6 * t)]);
  }
  return [
    { pts: main, radius: 6 },
    { pts: loop, radius: 5 },
    { pts: underline, radius: 4 },
  ];
}

/** Anti-aliased ink coverage per pixel in [0,1], by stamping discs along the polylines. */
function rasterize(strokes: Stroke[]): Float32Array {
  const cov = new Float32Array(W * H);
  for (const { pts, radius } of strokes) {
    for (const [px, py] of pts) {
      const x0 = Math.max(0, Math.floor(px - radius - 1));
      const x1 = Math.min(W - 1, Math.ceil(px + radius + 1));
      const y0 = Math.max(0, Math.floor(py - radius - 1));
      const y1 = Math.min(H - 1, Math.ceil(py + radius + 1));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
          const a = Math.min(1, Math.max(0, radius + 0.5 - d));
          if (a > cov[y * W + x]) cov[y * W + x] = a;
        }
      }
    }
  }
  return cov;
}

type PhotoOpts = {
  paper: [number, number, number];
  ink: [number, number, number];
  gradient: boolean; // simulate uneven lighting / shadow across the photo
  noiseSigma: number;
  lines: boolean; // ruled paper
  seed: number;
};

const LINE_ROWS: number[] = [];
for (let y = 60; y < H; y += 60) LINE_ROWS.push(y);

function renderPhoto(cov: Float32Array, o: PhotoOpts): PNG {
  const rnd = mulberry32(o.seed);
  const gauss = (): number => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const png = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      // Illumination: bright at top-left, ~30% darker at bottom-right.
      const illum = o.gradient ? 1.05 - 0.35 * ((x / W) * 0.6 + (y / H) * 0.4) : 1;
      let c: [number, number, number] = [...o.paper];
      if (o.lines && LINE_ROWS.some((ly) => y >= ly - 1 && y <= ly)) c = [150, 172, 205];
      const a = cov[i];
      const n = o.noiseSigma ? gauss() * o.noiseSigma : 0;
      for (let k = 0; k < 3; k++) {
        const v = (c[k] * (1 - a) + o.ink[k] * a) * illum + n;
        png.data[i * 4 + k] = Math.max(0, Math.min(255, Math.round(v)));
      }
      png.data[i * 4 + 3] = 255;
    }
  }
  return png;
}

function signatures(): void {
  const strokes = makeStrokes();
  const cov = rasterize(strokes);

  // Ground truth shared by all variants (same stroke geometry).
  let minX = W,
    minY = H,
    maxX = -1,
    maxY = -1;
  const mask = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = cov[y * W + x];
      if (a > 0.5) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      const v = a >= 0.99 ? 255 : 0;
      const j = (y * W + x) * 4;
      mask.data[j] = mask.data[j + 1] = mask.data[j + 2] = v;
      mask.data[j + 3] = 255;
    }
  }
  const truth = {
    width: W,
    height: H,
    note: 'bbox is the inclusive pixel extent of ink with coverage > 0.5. truth-mask: white = certain ink (coverage >= 0.99). lineRows (y of the 2px ruled lines) apply to sig-lined only.',
    bbox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    lineRows: LINE_ROWS,
  };
  writeFileSync(join(OUT, 'sig-truth.json'), JSON.stringify(truth, null, 2) + '\n');
  writeFileSync(join(OUT, 'sig-truth-mask.png'), PNG.sync.write(mask));

  const variants: [string, PhotoOpts][] = [
    [
      'sig-clean.png',
      {
        paper: [255, 255, 255],
        ink: [20, 20, 25],
        gradient: false,
        noiseSigma: 0,
        lines: false,
        seed: 1,
      },
    ],
    [
      'sig-gradient-noise.png',
      {
        paper: [236, 232, 222],
        ink: [25, 25, 30],
        gradient: true,
        noiseSigma: 4,
        lines: false,
        seed: 2,
      },
    ],
    [
      'sig-lined.png',
      {
        paper: [244, 241, 232],
        ink: [25, 25, 30],
        gradient: true,
        noiseSigma: 2.5,
        lines: true,
        seed: 3,
      },
    ],
    [
      'sig-blue.png',
      {
        paper: [250, 250, 250],
        ink: [25, 50, 140],
        gradient: false,
        noiseSigma: 2,
        lines: false,
        seed: 4,
      },
    ],
  ];
  for (const [name, opts] of variants) {
    writeFileSync(join(OUT, name), PNG.sync.write(renderPhoto(cov, opts)));
    console.log(`wrote ${name}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Extra synthetic signature photos (T3): cursive variable-width pen, a rotated + shadowed phone
// photo, a heavily compressed JPEG and initials. Each has its own ground truth:
// sig-extra-truth.json (bbox of ink with coverage > 0.5) and <name>-mask.png (white = certain ink).
// ---------------------------------------------------------------------------------------------

type Pt = [number, number];
/** A pen path; `radius(s, total, tx, ty)` gives the pen radius at arc length s (tx, ty = unit tangent). */
type Pen = { pts: Pt[]; radius: (s: number, total: number, tx: number, ty: number) => number };
type StampedPoint = { x: number; y: number; r: number };

/** Resample a polyline at ~0.4px spacing and attach the pen radius to every sample. */
function stampPen(pen: Pen, xf: (p: Pt) => Pt): StampedPoint[] {
  const pts = pen.pts.map(xf);
  const seg: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    seg.push(seg[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const total = seg[seg.length - 1];
  const out: StampedPoint[] = [];
  let j = 1;
  for (let s = 0; s <= total; s += 0.4) {
    while (j < pts.length - 1 && seg[j] < s) j++;
    const d = seg[j] - seg[j - 1] || 1;
    const f = (s - seg[j - 1]) / d;
    const x = pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * f;
    const y = pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * f;
    const tx = (pts[j][0] - pts[j - 1][0]) / d;
    const ty = (pts[j][1] - pts[j - 1][1]) / d;
    out.push({ x, y, r: pen.radius(s, total, tx, ty) });
  }
  return out;
}

function rasterizeStamps(stamps: StampedPoint[], w: number, h: number): Float32Array {
  const cov = new Float32Array(w * h);
  for (const { x: px, y: py, r } of stamps) {
    const x0 = Math.max(0, Math.floor(px - r - 1));
    const x1 = Math.min(w - 1, Math.ceil(px + r + 1));
    const y0 = Math.max(0, Math.floor(py - r - 1));
    const y1 = Math.min(h - 1, Math.ceil(py + r + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const a = Math.min(1, Math.max(0, r + 0.5 - Math.hypot(x + 0.5 - px, y + 0.5 - py)));
        if (a > cov[y * w + x]) cov[y * w + x] = a;
      }
    }
  }
  return cov;
}

/** Calligraphic pen: downstrokes are thick, upstrokes hairline, with tapered ends. */
function calligraphic(rMin: number, rMax: number): Pen['radius'] {
  return (s, total, _tx, ty) => {
    const press = Math.max(0, ty); // image y grows downward: ty > 0 is a downstroke
    const taper = Math.min(1, 0.35 + s / 25, 0.35 + (total - s) / 25);
    return (rMin + (rMax - rMin) * press * press) * taper;
  };
}

function curve(n: number, f: (t: number) => Pt): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) pts.push(f(i / n));
  return pts;
}

/** A cursive-looking name: big capital loop, a run of connected loops, a flourish and an i-dot. */
function cursivePens(): Pen[] {
  const pen = calligraphic(1.7, 5.4);
  // Big capital: an S-like double loop.
  const capital = curve(500, (t): Pt => {
    const a = 2 * Math.PI * 1.35 * t;
    return [
      200 + 70 * Math.sin(a) * (1 - 0.3 * t) + 40 * t,
      330 - 150 * Math.cos(a * 0.9) * (0.6 + 0.4 * t) + 40 * t,
    ];
  });
  // Connected loops left to right (trochoid), amplitude modulated.
  const word = curve(1400, (t): Pt => {
    const a = 2 * Math.PI * 7.5 * t;
    return [
      280 + 640 * t + 34 * Math.cos(a) * (0.8 + 0.5 * Math.sin(Math.PI * t)),
      330 - 62 * Math.sin(a) * (0.7 + 0.6 * Math.sin(Math.PI * t)) - 18 * t,
    ];
  });
  // Trailing flourish underneath, from the end of the word back to the left.
  const flourish = curve(600, (t): Pt => [
    930 - 760 * t + 20 * Math.sin(5 * t),
    430 + 36 * Math.sin(Math.PI * t) - 30 * t,
  ]);
  const dot = curve(24, (t): Pt => [
    640 + 6 * Math.cos(2 * Math.PI * t),
    215 + 6 * Math.sin(2 * Math.PI * t),
  ]);
  return [
    { pts: capital, radius: pen },
    { pts: word, radius: pen },
    { pts: flourish, radius: calligraphic(1.4, 3.6) },
    { pts: dot, radius: () => 3.2 },
  ];
}

/** "DM" initials in a broad pen. */
function initialsPens(): Pen[] {
  const pen = calligraphic(3.6, 7.4);
  const dStem = curve(80, (t): Pt => [260, 180 + 400 * t]);
  const dBowl = curve(240, (t): Pt => {
    const a = -Math.PI / 2 + Math.PI * t;
    return [260 + 200 * Math.cos(a), 380 + 200 * Math.sin(a)];
  });
  const mLeft = curve(60, (t): Pt => [560, 580 - 400 * t]);
  const mVee1 = curve(60, (t): Pt => [560 + 90 * t, 180 + 280 * t]);
  const mVee2 = curve(60, (t): Pt => [650 + 90 * t, 460 - 280 * t]);
  const mRight = curve(60, (t): Pt => [740, 180 + 400 * t]);
  return [dStem, dBowl, mLeft, mVee1, mVee2, mRight].map((pts) => ({ pts, radius: pen }));
}

type Look = {
  w: number;
  h: number;
  paper: [number, number, number];
  ink: [number, number, number];
  noiseSigma: number;
  seed: number;
  /** multiplicative lighting map, 1 = neutral */
  light: (x: number, y: number) => number;
  /** optional ruled-line coverage drawn under the ink, in `lineColor` */
  lineCov?: Float32Array;
  lineColor?: [number, number, number];
};

/**
 * Spiky signature with long, slightly curved, tapered near-horizontal flourishes (the failure case
 * for ruled-line removal): flourish A spans ~70% of the ink width, flourish B ~50%.
 */
function flourishPens(): Pen[] {
  const taper =
    (rMax: number, rMin: number): Pen['radius'] =>
    (s, total) =>
      rMin + (rMax - rMin) * Math.min(1, (total - s) / (0.7 * total)) * Math.min(1, 0.3 + s / 30);
  const spike1 = curve(120, (t): Pt => [262 + 6 * t, 150 + 330 * t]);
  const spike2 = curve(100, (t): Pt => [322 + 28 * Math.sin(Math.PI * t * 0.8), 150 + 200 * t]);
  const flourishA = curve(500, (t): Pt => [268 + 540 * t, 345 - 45 * Math.sin(Math.PI * 0.85 * t)]);
  const spike3 = curve(100, (t): Pt => [640 - 22 * t, 190 + 290 * t]);
  const flourishB = curve(400, (t): Pt => [632 + 380 * t, 420 + 26 * Math.sin(Math.PI * 0.9 * t)]);
  return [
    { pts: spike1, radius: taper(3.2, 1.2) },
    { pts: spike2, radius: taper(3, 1.2) },
    { pts: flourishA, radius: taper(3.4, 0.9) },
    { pts: spike3, radius: taper(3.2, 1.2) },
    { pts: flourishB, radius: taper(3.2, 0.9) },
  ];
}

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function renderLook(cov: Float32Array, o: Look): Uint8ClampedArray {
  const rnd = mulberry32(o.seed);
  const gauss = (): number => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const data = new Uint8ClampedArray(o.w * o.h * 4);
  for (let y = 0; y < o.h; y++) {
    for (let x = 0; x < o.w; x++) {
      const i = y * o.w + x;
      const a = cov[i];
      const l = o.lineCov && o.lineColor ? o.lineCov[i] : 0;
      const illum = o.light(x, y);
      const n = o.noiseSigma ? gauss() * o.noiseSigma : 0;
      for (let k = 0; k < 3; k++) {
        const base = l ? o.paper[k] * (1 - l) + o.lineColor![k] * l : o.paper[k];
        data[i * 4 + k] = Math.round((base * (1 - a) + o.ink[k] * a) * illum + n);
      }
      data[i * 4 + 3] = 255;
    }
  }
  return data;
}

function pngBytes(data: Uint8ClampedArray, w: number, h: number): Buffer {
  const png = new PNG({ width: w, height: h });
  png.data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return PNG.sync.write(png);
}

function jpegBytes(data: Uint8ClampedArray, w: number, h: number, quality: number): Buffer {
  const canvas = createCanvas(w, h);
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
  return canvas.encodeSync('jpeg', quality);
}

type ExtraTruth = {
  width: number;
  height: number;
  bbox: { x: number; y: number; width: number; height: number };
  mask: string;
  note: string;
};

function extraSignatures(): void {
  const truths: Record<string, ExtraTruth> = {};
  const identity = (p: Pt): Pt => p;

  const emit = (
    name: string,
    cov: Float32Array,
    look: Look,
    format: { kind: 'png' } | { kind: 'jpeg'; quality: number },
    note: string,
  ): void => {
    const { w, h } = look;
    let minX = w,
      minY = h,
      maxX = -1,
      maxY = -1;
    const mask = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = cov[y * w + x];
        if (a > 0.5) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
        const v = a >= 0.99 ? 255 : 0;
        const j = (y * w + x) * 4;
        mask.data[j] = mask.data[j + 1] = mask.data[j + 2] = v;
        mask.data[j + 3] = 255;
      }
    }
    const base = name.replace(/\.[a-z]+$/, '');
    const maskName = `${base}-mask.png`;
    writeFileSync(join(OUT, maskName), PNG.sync.write(mask));
    truths[name] = {
      width: w,
      height: h,
      bbox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      mask: maskName,
      note,
    };
    const pixels = renderLook(cov, look);
    const bytes =
      format.kind === 'png' ? pngBytes(pixels, w, h) : jpegBytes(pixels, w, h, format.quality);
    writeFileSync(join(OUT, name), bytes);
    console.log(`wrote ${name} (${(bytes.length / 1024).toFixed(1)} KB)`);
  };

  // 1. Cursive, variable pen width, mild lighting.
  const W1 = 1200,
    H1 = 600;
  const cursive = cursivePens();
  const covCursive = rasterizeStamps(
    cursive.flatMap((p) => stampPen(p, identity)),
    W1,
    H1,
  );
  emit(
    'sig-cursive.png',
    covCursive,
    {
      w: W1,
      h: H1,
      paper: [241, 237, 228],
      ink: [28, 28, 38],
      noiseSigma: 1.2,
      seed: 11,
      light: (x, y) => 1.02 - 0.15 * ((x / W1) * 0.5 + (y / H1) * 0.5),
    },
    { kind: 'png' },
    'Cursive strokes, pen radius 1.4-5.4 px (thick downstrokes, hairline upstrokes), plus a small i-dot.',
  );

  // 2. Slightly rotated, shadowed phone photo (JPEG q82).
  const theta = (4.5 * Math.PI) / 180;
  const cx = W1 / 2,
    cy = H1 / 2;
  const rot = (p: Pt): Pt => {
    const dx = (p[0] - cx) * 0.92,
      dy = (p[1] - cy) * 0.92;
    return [
      cx + dx * Math.cos(theta) - dy * Math.sin(theta),
      cy + dx * Math.sin(theta) + dy * Math.cos(theta),
    ];
  };
  const covPhone = rasterizeStamps(
    cursive.flatMap((p) => stampPen(p, rot)),
    W1,
    H1,
  );
  emit(
    'sig-phone.jpg',
    covPhone,
    {
      w: W1,
      h: H1,
      paper: [233, 228, 212],
      ink: [22, 26, 48],
      noiseSigma: 3,
      seed: 12,
      light: (x, y) => {
        // Soft diagonal shadow (160px penumbra, 32% darker) plus a vignette.
        const d = x * 0.6 + y * 0.8 - 560; // signed distance to a diagonal line
        const shadow = 1 - 0.32 * smoothstep(-80, 80, d);
        const rr = Math.hypot((x - cx) / cx, (y - cy) / cy);
        return shadow * (1.04 - 0.14 * rr * rr);
      },
    },
    { kind: 'jpeg', quality: 82 },
    'Cursive strokes rotated 4.5 degrees and scaled 0.92, soft diagonal shadow, vignette, noise, JPEG q82.',
  );

  // 3. Heavy JPEG (q8): blocking and ringing around the strokes.
  emit(
    'sig-jpeg-heavy.jpg',
    covCursive,
    {
      w: W1,
      h: H1,
      paper: [247, 246, 243],
      ink: [30, 30, 36],
      noiseSigma: 2,
      seed: 13,
      light: (x, y) => 1.0 - 0.1 * (x / W1) - 0.05 * (y / H1),
    },
    { kind: 'jpeg', quality: 8 },
    'Same strokes as sig-cursive.png, JPEG quality 8 (heavy blocking/ringing).',
  );

  // 4. Initials "DM" in a broad pen.
  const W4 = 1000,
    H4 = 760;
  const covInitials = rasterizeStamps(
    initialsPens().flatMap((p) => stampPen(p, identity)),
    W4,
    H4,
  );
  emit(
    'sig-initials.png',
    covInitials,
    {
      w: W4,
      h: H4,
      paper: [250, 249, 246],
      ink: [20, 30, 90],
      noiseSigma: 1.5,
      seed: 14,
      light: (x, y) => 1.03 - 0.22 * ((x / W4) * 0.3 + (y / H4) * 0.7),
    },
    { kind: 'png' },
    'Blue "DM" initials, broad pen radius 3.6-7.4 px, bottom-heavy lighting gradient.',
  );

  // 5 + 6. Regression pair for "Remove lines": long curved flourishes, plain and on ruled paper.
  const flourish = flourishPens();
  const covFlourish = rasterizeStamps(
    flourish.flatMap((p) => stampPen(p, identity)),
    W1,
    H1,
  );
  // Ruled lines every 60px, tilted 0.6 degrees, ~2px thick, drawn under the ink.
  const ruleSlope = Math.tan((0.6 * Math.PI) / 180);
  const covLines = rasterizeStamps(
    [60, 120, 180, 240, 300, 360, 420, 480, 540].flatMap((row) =>
      stampPen(
        {
          pts: [
            [0, row],
            [W1, row],
          ],
          radius: () => 1.0,
        },
        ([x, y]): Pt => [x, y + x * ruleSlope],
      ),
    ),
    W1,
    H1,
  );
  const flourishLook = {
    w: W1,
    h: H1,
    paper: [243, 240, 231] as [number, number, number],
    ink: [24, 24, 34] as [number, number, number],
    noiseSigma: 2,
    light: (x: number, y: number) => 1.02 - 0.12 * ((x / W1) * 0.6 + (y / H1) * 0.4),
  };
  emit(
    'sig-flourish.png',
    covFlourish,
    { ...flourishLook, seed: 15 },
    { kind: 'png' },
    'Spiky signature with two long, slightly curved, tapered flourishes (~70% and ~50% of the ink width) on plain paper. Regression fixture for Remove lines.',
  );
  emit(
    'sig-flourish-lined.png',
    covFlourish,
    { ...flourishLook, seed: 16, lineCov: covLines, lineColor: [105, 110, 125] },
    { kind: 'png' },
    'Same strokes as sig-flourish.png on ruled paper (9 lines, 60px apart, 0.6 degree tilt, y = 60k + 0.0105 x, ~2px thick, grey). Truth covers the ink only.',
  );

  writeFileSync(join(OUT, 'sig-extra-truth.json'), JSON.stringify(truths, null, 2) + '\n');
}

async function main(): Promise<void> {
  await simple3Page();
  await mixedSizes();
  await rotated();
  await cropboxOffset();
  await acroform();
  const encOk = await encrypted();
  await large50();
  signatures();
  extraSignatures();
  if (!encOk) process.exitCode = 1;
}

void main();
