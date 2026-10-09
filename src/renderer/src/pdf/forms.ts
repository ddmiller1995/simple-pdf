import {
  EncryptedPDFError,
  PDFBool,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  type PDFField,
} from '@cantoo/pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { DocCapabilities, FormValue, FormValues } from '@shared/types';

/**
 * AcroForm discovery and fill/flatten (plan §6 T4).
 *
 * Known limitation: field appearances are generated with Helvetica (WinAnsi). A text value with
 * characters outside WinAnsi would be silently replaced by '?' by pdf-lib, so instead that field
 * stays filled but unflattened (and is logged). Embedding Noto Sans for form fields is left to T2's font work.
 */

async function countFields(pdfjsDoc: PDFDocumentProxy): Promise<number> {
  try {
    const fields = await pdfjsDoc.getFieldObjects();
    return fields ? fields.size : 0;
  } catch {
    return 0;
  }
}

/**
 * Decide whether the document can be edited. `hasAcroForm` is true when PDF.js finds any field.
 * Pure-XFA forms and encrypted documents are view-only.
 */
export async function detectCapabilities(
  pdfjsDoc: PDFDocumentProxy,
  bytes: Uint8Array,
): Promise<DocCapabilities> {
  const hasAcroForm = (await countFields(pdfjsDoc)) > 0;

  // Pure XFA: PDF.js renders it from XFA data only; we cannot fill or flatten it.
  if (pdfjsDoc.isPureXfa || pdfjsDoc.allXfaHtml) {
    return { editable: false, hasAcroForm, reason: 'xfa' };
  }

  try {
    // Throws EncryptedPDFError for encrypted files (we cannot write those back).
    await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  } catch (err) {
    if (err instanceof EncryptedPDFError) {
      return { editable: false, hasAcroForm, reason: 'encrypted' };
    }
    // PDF.js parsed it but pdf-lib cannot: viewing works, saving would not.
    console.error('pdf-lib could not parse document', err);
    return { editable: false, hasAcroForm, reason: 'unparseable' };
  }
  return { editable: true, hasAcroForm };
}

function firstString(value: FormValue): string {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' ? v : '';
}

/**
 * pdf-lib silently substitutes '?' for characters the font cannot encode, which would corrupt
 * the user's data. Refuse instead, so the field is left unflattened.
 */
function assertEncodable(text: string, encodable: Set<number>): void {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x0a || cp === 0x0d || cp === 0x09) continue;
    if (!encodable.has(cp)) {
      throw new Error(`character U+${cp.toString(16).toUpperCase()} is outside WinAnsi`);
    }
  }
}

function setFieldValue(field: PDFField, value: FormValue): void {
  if (field instanceof PDFTextField) {
    field.setText(Array.isArray(value) ? value.join('\n') : String(value));
  } else if (field instanceof PDFCheckBox) {
    if (value === true || value === 'true' || value === 'on') field.check();
    else field.uncheck();
  } else if (field instanceof PDFRadioGroup || field instanceof PDFDropdown) {
    const v = firstString(value);
    if (v !== '') field.select(v);
    else field.clear();
  } else if (field instanceof PDFOptionList) {
    const v = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
    if (v.length > 0) field.select(v);
    else field.clear();
  } else {
    throw new Error(`Unsupported field type for "${field.getName()}"`);
  }
}

/**
 * Write `formValues` into the document's AcroForm, then flatten it into page content.
 * Each field is handled independently: a field that fails (unknown value, characters outside
 * WinAnsi, ...) is logged and left as a live, filled field (NeedAppearances is set so viewers
 * regenerate it) instead of failing the whole save.
 *
 * NOTE for callers: `PDFDocument.save()` regenerates appearances for every remaining field and
 * would throw for a field that failed here, so call `save({ updateFieldAppearances: false })`.
 */
export function applyFormValues(pdfLibDoc: PDFDocument, formValues: FormValues): void {
  const form = pdfLibDoc.getForm();
  const fields = form.getFields();
  if (fields.length === 0) return;

  const font = pdfLibDoc.embedStandardFont(StandardFonts.Helvetica);
  const encodable = new Set(font.getCharacterSet());
  const failed = new Set<PDFField>();
  const byName = new Map(fields.map((f) => [f.getName(), f]));

  for (const [name, value] of Object.entries(formValues)) {
    const field = byName.get(name);
    if (!field) {
      console.warn(`applyFormValues: no field named "${name}"`);
      continue;
    }
    try {
      setFieldValue(field, value);
      if (field instanceof PDFTextField) assertEncodable(field.getText() ?? '', encodable);
    } catch (err) {
      console.error(`applyFormValues: could not set "${name}"`, err);
      failed.add(field);
    }
  }

  // Build appearances field by field so one bad value does not abort the rest.
  for (const field of fields) {
    if (failed.has(field)) continue;
    try {
      if (
        field instanceof PDFTextField ||
        field instanceof PDFDropdown ||
        field instanceof PDFOptionList
      ) {
        field.defaultUpdateAppearances(font);
      } else if (field instanceof PDFCheckBox || field instanceof PDFRadioGroup) {
        field.defaultUpdateAppearances();
      }
    } catch (err) {
      console.error(`applyFormValues: could not build appearance for "${field.getName()}"`, err);
      failed.add(field);
    }
  }

  // Flatten everything that succeeded. PDFForm.flatten has no per-field switch, so narrow
  // getFields() for the duration of the call.
  const flattenable = fields.filter((f) => !failed.has(f));
  const original = form.getFields.bind(form);
  form.getFields = () => flattenable;
  try {
    form.flatten({ updateFieldAppearances: false });
  } catch (err) {
    console.error('applyFormValues: flatten failed', err);
  } finally {
    form.getFields = original;
  }

  if (failed.size > 0) {
    form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
  }
}
