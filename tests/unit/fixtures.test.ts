import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { loadFixture, loadPng, loadSigTruth } from '../helpers/fixtures';

describe('fixtures', () => {
  it.each([
    ['simple-3page.pdf', 3],
    ['mixed-sizes.pdf', 3],
    ['rotated.pdf', 4],
    ['cropbox-offset.pdf', 1],
    ['acroform.pdf', 1],
    ['large-50page.pdf', 50],
  ])('%s loads with the expected page count', async (name, pages) => {
    const doc = await PDFDocument.load(loadFixture(name));
    expect(doc.getPageCount()).toBe(pages);
  });

  it('rotated.pdf has /Rotate 0/90/180/270', async () => {
    const doc = await PDFDocument.load(loadFixture('rotated.pdf'));
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90, 180, 270]);
  });

  it('cropbox-offset.pdf has CropBox != MediaBox', async () => {
    const page = (await PDFDocument.load(loadFixture('cropbox-offset.pdf'))).getPage(0);
    expect(page.getMediaBox()).toMatchObject({ x: 0, y: 0, width: 612, height: 792 });
    expect(page.getCropBox()).toMatchObject({ x: 50, y: 100, width: 400, height: 500 });
  });

  it('acroform.pdf has all field types', async () => {
    const form = (await PDFDocument.load(loadFixture('acroform.pdf'))).getForm();
    expect(
      form
        .getFields()
        .map((f) => f.getName())
        .sort(),
    ).toEqual(['agree', 'color', 'country', 'fullName', 'interests', 'notes'].sort());
  });

  it('encrypted.pdf is rejected by pdf-lib unless encryption is ignored', async () => {
    await expect(PDFDocument.load(loadFixture('encrypted.pdf'))).rejects.toThrow(/encrypted/i);
  });

  it('signature photos decode and share the ground-truth size', () => {
    const truth = loadSigTruth();
    for (const name of [
      'sig-clean.png',
      'sig-gradient-noise.png',
      'sig-lined.png',
      'sig-blue.png',
    ]) {
      const img = loadPng(name);
      expect([img.width, img.height]).toEqual([truth.width, truth.height]);
    }
    expect(truth.bbox.width).toBeGreaterThan(500);
  });
});
