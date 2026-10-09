import notoSansUrl from '../../../../resources/fonts/NotoSans-Regular.ttf?url';

/**
 * The single bundled text font (plan D9). The renderer loads it from the local build output;
 * Node tests inject the bytes with `setFontBytes` (read from `resources/fonts` on disk).
 * Shared by textLayout (metrics) and export (embedding), and by the screen `@font-face`.
 */

/** CSS `font-family` name the screen TextBox must use for the Noto Sans face below. */
export const FONT_FAMILY = 'Noto Sans';

/** Bundled URL of NotoSans-Regular.ttf, for `@font-face { src: url(...) }` on screen. */
export const FONT_URL: string = notoSansUrl;

let cached: Promise<Uint8Array> | null = null;

/** Inject the font bytes (tests, or any caller that already has them). Replaces the cache. */
export function setFontBytes(bytes: Uint8Array): void {
  cached = Promise.resolve(bytes);
}

/** The font file bytes; fetched once from the bundled asset (local file, no network). */
export function getFontBytes(): Promise<Uint8Array> {
  cached ??= fetch(FONT_URL).then(async (res) => {
    if (!res.ok) throw new Error(`Could not load the bundled font (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  });
  cached.catch(() => {
    cached = null; // allow a retry after a failure
  });
  return cached;
}
