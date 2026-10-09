import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_PNG_BYTES,
  createSignatureStore,
  parseSignatureInput,
  type NewSignature,
} from '../../src/main/signatureStore';
import { loadFixture } from '../helpers/fixtures';

const pngUrl = (bytes: Uint8Array | Buffer): string =>
  'data:image/png;base64,' + Buffer.from(bytes).toString('base64');
const goodPng = (): string => pngUrl(loadFixture('sig-truth-mask.png'));
const sig = (over: Partial<NewSignature> = {}): NewSignature => ({
  label: 'My signature',
  kind: 'signature',
  pngDataUrl: goodPng(),
  ...over,
});

let dir: string;
beforeEach(async () => {
  dir = join(await mkdtemp(join(tmpdir(), 'simple-pdf-sigs-')), 'signatures'); // does not exist yet
});
afterEach(async () => {
  await rm(join(dir, '..'), { recursive: true, force: true });
});

describe('signature store', () => {
  it('starts empty and creates the directory on first add', async () => {
    const store = createSignatureStore(dir);
    expect(await store.list()).toEqual([]);
    const a = await store.add(sig());
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.label).toBe('My signature');
    expect(Date.parse(a.createdAt)).not.toBeNaN();
    expect((await readdir(dir)).sort()).toEqual(['index.json', `${a.id}.png`].sort());
  });

  it('persists across store instances (simulated restart) and round-trips the PNG bytes', async () => {
    const original = loadFixture('sig-truth-mask.png');
    const first = createSignatureStore(dir);
    const a = await first.add(sig({ label: 'One' }));
    const b = await first.add(sig({ label: 'Initials', kind: 'initials' }));

    const second = createSignatureStore(dir);
    const list = await second.list();
    expect(list.map((s) => s.id)).toEqual([a.id, b.id]);
    expect(list[1]).toMatchObject({ label: 'Initials', kind: 'initials' });
    expect(
      Buffer.from(list[0].pngDataUrl.split(',')[1], 'base64').equals(Buffer.from(original)),
    ).toBe(true);
    expect(
      Buffer.from(await readFile(join(dir, `${a.id}.png`))).equals(Buffer.from(original)),
    ).toBe(true);
  });

  it('deletes an entry and its file; deleting an unknown id is a no-op', async () => {
    const store = createSignatureStore(dir);
    const a = await store.add(sig());
    const b = await store.add(sig({ label: 'B' }));
    await store.delete(a.id);
    expect((await store.list()).map((s) => s.id)).toEqual([b.id]);
    expect(await readdir(dir)).not.toContain(`${a.id}.png`);
    await store.delete('00000000-0000-4000-8000-000000000000');
    expect(await store.list()).toHaveLength(1);
  });

  it('rejects ids that are not UUIDs (no path traversal)', async () => {
    const store = createSignatureStore(dir);
    await store.add(sig());
    await expect(store.delete('../index')).rejects.toThrow(/invalid signature id/i);
    await expect(store.delete('')).rejects.toThrow();
    expect(await store.list()).toHaveLength(1);
  });

  it('serialises concurrent adds without losing entries', async () => {
    const store = createSignatureStore(dir);
    await Promise.all([1, 2, 3, 4, 5].map((n) => store.add(sig({ label: `s${n}` }))));
    const list = await store.list();
    expect(list).toHaveLength(5);
    expect(new Set(list.map((s) => s.id)).size).toBe(5);
  });

  it('skips entries whose image is missing and survives a corrupt index', async () => {
    const store = createSignatureStore(dir);
    const a = await store.add(sig());
    await rm(join(dir, `${a.id}.png`));
    expect(await store.list()).toEqual([]);

    await writeFile(join(dir, 'index.json'), '{not json');
    expect(await store.list()).toEqual([]);
    const b = await store.add(sig({ label: 'after corruption' }));
    expect((await store.list()).map((s) => s.id)).toEqual([b.id]);
  });
});

describe('signature input validation', () => {
  it('rejects non-PNG data URLs', () => {
    expect(() =>
      parseSignatureInput(sig({ pngDataUrl: 'data:image/jpeg;base64,/9j/4AAQ' })),
    ).toThrow(/PNG data URL/);
    expect(() => parseSignatureInput(sig({ pngDataUrl: 'http://evil.example/x.png' }))).toThrow();
    expect(() => parseSignatureInput(sig({ pngDataUrl: '' }))).toThrow();
  });

  it('rejects data that claims PNG but is not', () => {
    expect(() =>
      parseSignatureInput(sig({ pngDataUrl: pngUrl(Buffer.from('hello world, not a png')) })),
    ).toThrow(/not a PNG/);
    expect(() => parseSignatureInput(sig({ pngDataUrl: 'data:image/png;base64,@@@@' }))).toThrow(
      /base64/,
    );
  });

  it('rejects images over 5 MB', () => {
    const big = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(MAX_PNG_BYTES),
    ]);
    expect(() => parseSignatureInput(sig({ pngDataUrl: pngUrl(big) }))).toThrow(/5 MB/);
  });

  it('rejects a bad kind or non-object payloads', () => {
    expect(() => parseSignatureInput(sig({ kind: 'stamp' as 'signature' }))).toThrow(/kind/);
    expect(() => parseSignatureInput(null)).toThrow();
    expect(() => parseSignatureInput('x')).toThrow();
  });

  it('trims and defaults labels', () => {
    expect(parseSignatureInput(sig({ label: '  Dakota  ' })).label).toBe('Dakota');
    expect(parseSignatureInput(sig({ label: '   ' })).label).toBe('Signature');
    expect(parseSignatureInput(sig({ label: '', kind: 'initials' })).label).toBe('Initials');
    expect(parseSignatureInput(sig({ label: 'x'.repeat(500) })).label).toHaveLength(100);
  });
});
