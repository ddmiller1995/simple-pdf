import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

export const FIXTURES_DIR = join(__dirname, '..', 'fixtures');

export function fixturePath(name: string): string {
  return join(FIXTURES_DIR, name);
}

/** Fixture file as a standalone Uint8Array (a fresh copy, safe to hand to PDF.js, which may detach it). */
export function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fixturePath(name)));
}

/** Decode a PNG fixture to RGBA (same shape as `RgbaImage` in signature/extract.ts). */
export function loadPng(name: string): { data: Uint8ClampedArray; width: number; height: number } {
  const png = PNG.sync.read(readFileSync(fixturePath(name)));
  return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
}

export type SigTruth = {
  width: number;
  height: number;
  bbox: { x: number; y: number; width: number; height: number };
  lineRows: number[];
};

export function loadSigTruth(): SigTruth {
  return JSON.parse(readFileSync(fixturePath('sig-truth.json'), 'utf8')) as SigTruth;
}
