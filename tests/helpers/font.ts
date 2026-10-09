import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFontBytes } from '../../src/renderer/src/pdf/fontSource';
import { initTextLayout } from '../../src/renderer/src/pdf/textLayout';

export const NOTO_SANS_PATH = join(
  __dirname,
  '..',
  '..',
  'resources',
  'fonts',
  'NotoSans-Regular.ttf',
);

/** Node tests read the bundled font from disk (the renderer fetches it via a Vite asset URL). */
export function notoSansBytes(): Uint8Array {
  return new Uint8Array(readFileSync(NOTO_SANS_PATH));
}

/** Call in `beforeAll`: injects the font for export and initialises text layout. */
export async function useNotoSans(): Promise<void> {
  const bytes = notoSansBytes();
  setFontBytes(bytes);
  await initTextLayout(bytes);
}
