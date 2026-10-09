import type { LayerProps } from './layerProps';

// T0 stub. T4 renders the PDF.js AnnotationLayer (AcroForm inputs) here.
export function FormLayer(_props: LayerProps) {
  return <div className="page-layer form-layer" data-testid="form-layer" />;
}
