import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SavedSignature } from '../shared/types';

// Persistent signature library: <dir>/<uuid>.png + <dir>/index.json (metadata only).
// Pure Node (no electron import) so it is unit-testable; ipc.ts passes `userData/signatures`.

export const MAX_PNG_BYTES = 5 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DATA_URL_PREFIX = 'data:image/png;base64,';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_LABEL = 100;

type IndexEntry = Pick<SavedSignature, 'id' | 'label' | 'kind' | 'createdAt'>;
export type NewSignature = Omit<SavedSignature, 'id' | 'createdAt'>;

export interface SignatureStore {
  list(): Promise<SavedSignature[]>;
  add(sig: NewSignature): Promise<SavedSignature>;
  delete(id: string): Promise<void>;
}

/** Validate an untrusted renderer payload and return the decoded PNG bytes. Throws on anything odd. */
export function parseSignatureInput(sig: unknown): {
  label: string;
  kind: 'signature' | 'initials';
  png: Buffer;
} {
  if (typeof sig !== 'object' || sig === null) throw new Error('Invalid signature: not an object');
  const { label, kind, pngDataUrl } = sig as Record<string, unknown>;
  if (kind !== 'signature' && kind !== 'initials') throw new Error('Invalid signature: bad kind');
  if (typeof label !== 'string') throw new Error('Invalid signature: bad label');
  if (typeof pngDataUrl !== 'string' || !pngDataUrl.startsWith(DATA_URL_PREFIX)) {
    throw new Error('Invalid signature: image must be a PNG data URL');
  }
  const b64 = pngDataUrl.slice(DATA_URL_PREFIX.length);
  // Cheap size guard before decoding: base64 inflates by 4/3.
  if (b64.length > Math.ceil((MAX_PNG_BYTES * 4) / 3) + 4) {
    throw new Error('Invalid signature: image is larger than 5 MB');
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new Error('Invalid signature: bad base64');
  const png = Buffer.from(b64, 'base64');
  if (png.length > MAX_PNG_BYTES) throw new Error('Invalid signature: image is larger than 5 MB');
  if (png.length < PNG_MAGIC.length || !png.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error('Invalid signature: not a PNG');
  }
  const trimmed = label.trim().slice(0, MAX_LABEL);
  return { label: trimmed || (kind === 'initials' ? 'Initials' : 'Signature'), kind, png };
}

export function createSignatureStore(dir: string): SignatureStore {
  const indexPath = join(dir, 'index.json');
  const pngPath = (id: string): string => join(dir, `${id}.png`);

  // Serialise all operations: index.json is read-modify-write.
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  async function atomicWrite(path: string, data: string | Buffer): Promise<void> {
    const tmp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, data);
      await rename(tmp, path);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  async function readIndex(): Promise<IndexEntry[]> {
    let raw: string;
    try {
      raw = await readFile(indexPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('index is not an array');
      return parsed.filter(
        (e): e is IndexEntry =>
          typeof e === 'object' &&
          e !== null &&
          typeof e.id === 'string' &&
          UUID_RE.test(e.id) &&
          typeof e.label === 'string' &&
          (e.kind === 'signature' || e.kind === 'initials') &&
          typeof e.createdAt === 'string',
      );
    } catch {
      // Corrupt index: keep the broken file for inspection and start over rather than blocking the app.
      await rename(indexPath, `${indexPath}.corrupt-${Date.now()}`).catch(() => undefined);
      return [];
    }
  }

  const writeIndex = (entries: IndexEntry[]): Promise<void> =>
    atomicWrite(indexPath, JSON.stringify(entries, null, 2) + '\n');

  return {
    list: () =>
      exclusive(async () => {
        const entries = await readIndex();
        const out: SavedSignature[] = [];
        for (const e of entries) {
          try {
            const png = await readFile(pngPath(e.id));
            out.push({ ...e, pngDataUrl: DATA_URL_PREFIX + png.toString('base64') });
          } catch (err) {
            // A missing image file just hides that entry; anything else is a real problem.
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
          }
        }
        return out;
      }),

    add: (input) =>
      exclusive(async () => {
        const { label, kind, png } = parseSignatureInput(input);
        await mkdir(dir, { recursive: true });
        const entry: IndexEntry = {
          id: randomUUID(),
          label,
          kind,
          createdAt: new Date().toISOString(),
        };
        // Image first: an orphan PNG is harmless, an index entry without an image is not.
        await atomicWrite(pngPath(entry.id), png);
        try {
          await writeIndex([...(await readIndex()), entry]);
        } catch (err) {
          await rm(pngPath(entry.id), { force: true });
          throw err;
        }
        return { ...entry, pngDataUrl: DATA_URL_PREFIX + png.toString('base64') };
      }),

    delete: (id) =>
      exclusive(async () => {
        if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Error('Invalid signature id');
        const entries = await readIndex();
        await writeIndex(entries.filter((e) => e.id !== id));
        await rm(pngPath(id), { force: true });
      }),
  };
}
