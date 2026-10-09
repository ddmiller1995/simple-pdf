import type { FormValues, Overlay, PageInfo } from '@shared/types';

// T0 stub. T2 implements the export engine (plan §6 T2); the source bytes are never mutated.

export type ExportInput = {
  sourceBytes: Uint8Array;
  overlays: Overlay[];
  formValues: FormValues;
  pages: PageInfo[];
};

export function exportPdf(_input: ExportInput): Promise<Uint8Array> {
  throw new Error('NotImplemented: exportPdf');
}
