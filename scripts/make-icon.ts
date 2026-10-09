/** Renders build/icon.svg to build/icon.png (1024px) and build/icon.icns (macOS `iconutil`). */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const build = resolve(__dirname, '../build');
const svg = readFileSync(resolve(build, 'icon.svg'));

async function render(size: number): Promise<Buffer> {
  const img = await loadImage(svg);
  const canvas = createCanvas(size, size);
  canvas.getContext('2d').drawImage(img, 0, 0, size, size);
  return canvas.toBuffer('image/png');
}

async function main(): Promise<void> {
  writeFileSync(resolve(build, 'icon.png'), await render(1024));
  const set = resolve(build, 'icon.iconset');
  rmSync(set, { recursive: true, force: true });
  mkdirSync(set);
  for (const s of [16, 32, 128, 256, 512]) {
    writeFileSync(resolve(set, `icon_${s}x${s}.png`), await render(s));
    writeFileSync(resolve(set, `icon_${s}x${s}@2x.png`), await render(s * 2));
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', resolve(build, 'icon.icns')]);
  rmSync(set, { recursive: true, force: true });
}
void main();
