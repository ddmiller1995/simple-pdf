import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeFileAtomic } from '../../src/main/atomicWrite';

describe('writeFileAtomic', () => {
  it('writes the bytes, replaces an existing file and leaves no temp files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-'));
    const target = join(dir, 'out.pdf');
    writeFileSync(target, 'old');
    await writeFileAtomic(target, new Uint8Array([1, 2, 3]));
    expect([...readFileSync(target)]).toEqual([1, 2, 3]);
    expect(readdirSync(dir)).toEqual(['out.pdf']);
  });
  it('fails without leaving temp files when the directory is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-'));
    await expect(
      writeFileAtomic(join(dir, 'nope', 'x.pdf'), new Uint8Array([1])),
    ).rejects.toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });
});
