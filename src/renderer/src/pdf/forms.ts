import type { PDFDocument } from '@cantoo/pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { DocCapabilities, FormValues } from '@shared/types';

// T0 stub. T4 implements XFA/encryption detection and AcroForm fill + flatten.

/** TODO(T4): detect AcroForm / XFA / encryption. Until then everything is editable. */
export async function detectCapabilities(
  _pdfjsDoc: PDFDocumentProxy,
  _bytes: Uint8Array,
): Promise<DocCapabilities> {
  return { editable: true, hasAcroForm: false };
}

/** TODO(T4): fill text/checkbox/radio/dropdown/option-list fields, then flatten. No-op for now. */
export function applyFormValues(_pdfLibDoc: PDFDocument, _formValues: FormValues): void {}
