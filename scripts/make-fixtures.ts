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

async function main(): Promise<void> {
  await simple3Page();
  await mixedSizes();
  await rotated();
  await cropboxOffset();
  await acroform();
  const encOk = await encrypted();
  await large50();
  signatures();
  if (!encOk) process.exitCode = 1;
}

void main();
