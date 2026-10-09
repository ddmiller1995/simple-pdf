import { PDFDocument } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { describe, expect, it, vi } from 'vitest';
import { applyFormValues, detectCapabilities } from '@renderer/pdf/forms';
import { loadFixture } from '../helpers/fixtures';

async function openPdfjs(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    verbosity: 0,
  });
  return (await task.promise) as unknown as PDFDocumentProxy;
}

async function pageText(doc: PDFDocumentProxy): Promise<string> {
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  return content.items.map((i) => ('str' in i ? i.str : '')).join(' ');
}

async function fill(values: Parameters<typeof applyFormValues>[1]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(loadFixture('acroform.pdf'));
  applyFormValues(doc, values);
  return doc.save({ updateFieldAppearances: false });
}

describe('detectCapabilities', () => {
  it('acroform.pdf is editable and has a form', async () => {
    const bytes = loadFixture('acroform.pdf');
    const doc = await openPdfjs(bytes);
    expect(await detectCapabilities(doc, bytes)).toEqual({ editable: true, hasAcroForm: true });
  });

  it('a plain PDF has no AcroForm', async () => {
    const bytes = loadFixture('simple-3page.pdf');
    const doc = await openPdfjs(bytes);
    expect(await detectCapabilities(doc, bytes)).toEqual({ editable: true, hasAcroForm: false });
  });

  it('encrypted.pdf is view-only (encrypted)', async () => {
    const bytes = loadFixture('encrypted.pdf');
    const doc = await openPdfjs(bytes);
    const caps = await detectCapabilities(doc, bytes);
    expect(caps).toMatchObject({ editable: false, reason: 'encrypted' });
  });

  it('a pure XFA document is view-only (mocked PDF.js doc; no XFA fixture is committed)', async () => {
    const bytes = loadFixture('simple-3page.pdf');
    const fake = {
      isPureXfa: true,
      allXfaHtml: { children: [] },
      getFieldObjects: async () => null,
    } as unknown as PDFDocumentProxy;
    expect(await detectCapabilities(fake, bytes)).toEqual({
      editable: false,
      hasAcroForm: false,
      reason: 'xfa',
    });
  });

  it('bytes that pdf-lib cannot parse are view-only (unparseable)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = {
      isPureXfa: false,
      allXfaHtml: null,
      getFieldObjects: async () => null,
    } as unknown as PDFDocumentProxy;
    const caps = await detectCapabilities(fake, new Uint8Array([1, 2, 3, 4]));
    spy.mockRestore();
    expect(caps).toEqual({ editable: false, hasAcroForm: false, reason: 'unparseable' });
  });
});

describe('applyFormValues', () => {
  it('fills every field type, flattens, and leaves no fields', async () => {
    const out = await fill({
      fullName: 'Ada Lovelace',
      notes: 'Line one\nLine two',
      agree: true,
      color: 'green',
      country: 'Canada',
      interests: ['Cycling', 'Chess'],
    });

    const doc = await openPdfjs(out);
    expect(await doc.getFieldObjects()).toBeNull();
    const page = await doc.getPage(1);
    expect(await page.getAnnotations({ intent: 'display' })).toEqual([]);

    const text = await pageText(doc);
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('Line one');
    expect(text).toContain('Line two');
    expect(text).toContain('Canada');
    expect(text).toContain('Cycling');
    expect(text).toContain('Chess');

    // Also no AcroForm fields at the pdf-lib level.
    expect((await PDFDocument.load(out)).getForm().getFields()).toHaveLength(0);
  });

  it('with no values it still flattens and keeps the page labels', async () => {
    const out = await fill({});
    const doc = await openPdfjs(out);
    expect(await doc.getFieldObjects()).toBeNull();
    expect(await pageText(doc)).toContain('AcroForm test');
  });

  it('a value that cannot be encoded leaves that field unflattened without failing the rest', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await fill({ fullName: 'Ωmega 日本', country: 'Brazil' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();

    const form = (await PDFDocument.load(out)).getForm();
    expect(form.getFields().map((f) => f.getName())).toEqual(['fullName']);
    expect(form.getTextField('fullName').getText()).toBe('Ωmega 日本');
    expect(await pageText(await openPdfjs(out))).toContain('Brazil');
  });

  it('an unknown field name or option is logged and skipped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await fill({ nope: 'x', country: 'Atlantis', fullName: 'Still Works' });
    warn.mockRestore();
    err.mockRestore();
    expect(await pageText(await openPdfjs(out))).toContain('Still Works');
  });
});
