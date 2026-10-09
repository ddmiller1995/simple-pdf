import { useEffect, useRef } from 'react';
import { AnnotationLayer, AnnotationType } from 'pdfjs-dist';
import type { FormValue, FormValues } from '@shared/types';
import { getPdfDocument, getPdfPage } from '../pdf/loader';
import { useDocumentStore } from '../state/documentStore';
// Local package CSS (no network): styles the AnnotationLayer's HTML inputs.
import 'pdfjs-dist/web/pdf_viewer.css';
import './formLayer.css';
import type { LayerProps } from './layerProps';

/**
 * AcroForm inputs for one page: the PDF.js AnnotationLayer rendered with `renderForms: true`
 * (scripting stays off). The store's `formValues` is the source of truth; the DOM and PDF.js's
 * `annotationStorage` are kept in sync with it (so undo/redo and zoom re-renders show the right
 * values).
 *
 * Deviation from the plan text: the field name comes straight from the widget annotation's
 * `fieldName` (the same fully-qualified name `getFieldObjects()` keys by), which also gives us
 * the radio button value and field kind without a second lookup.
 *
 * Undo coalescing: typing in a text field produces ONE undo step per focus. The first keystroke
 * after focusing goes through `setFormValue` (one history entry); the following keystrokes
 * update `formValues` in place without adding history. Checkboxes, radios and selects commit on
 * every change (each is a single discrete action).
 */

type WidgetKind = 'text' | 'checkbox' | 'radio' | 'choice';

type Widget = {
  id: string;
  name: string;
  kind: WidgetKind;
  multi: boolean; // choice: list box that allows several selections
  buttonValue: string; // radio: the export value this button selects
  initial: FormValue; // the value stored in the PDF
};

type WidgetData = {
  id: string;
  fieldName?: string;
  fieldType?: string;
  fieldValue?: unknown;
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  combo?: boolean;
  multiSelect?: boolean;
  buttonValue?: string | null;
  exportValue?: string | null;
};

function toWidget(a: WidgetData): Widget | null {
  if (!a.fieldName || a.pushButton) return null;
  const base = { id: a.id, name: a.fieldName, multi: false, buttonValue: '' };
  const fv = a.fieldValue;
  if (a.fieldType === 'Tx') {
    return { ...base, kind: 'text', initial: typeof fv === 'string' ? fv : '' };
  }
  if (a.fieldType === 'Btn' && a.checkBox) {
    return { ...base, kind: 'checkbox', initial: fv != null && fv !== '' && fv !== 'Off' };
  }
  if (a.fieldType === 'Btn' && a.radioButton) {
    const buttonValue = a.buttonValue ?? '';
    return {
      ...base,
      kind: 'radio',
      buttonValue,
      initial: fv != null && fv === buttonValue ? buttonValue : '',
    };
  }
  if (a.fieldType === 'Ch') {
    const values = Array.isArray(fv) ? (fv as string[]) : typeof fv === 'string' && fv ? [fv] : [];
    const multi = !a.combo && !!a.multiSelect;
    return { ...base, kind: 'choice', multi, initial: multi ? values : (values[0] ?? '') };
  }
  return null;
}

/** What PDF.js's annotationStorage expects for a widget showing `value`. */
function storageValue(w: Widget, value: FormValue): { value: unknown } {
  switch (w.kind) {
    case 'text':
      return { value: Array.isArray(value) ? value.join('\n') : String(value) };
    case 'checkbox':
      return { value: value === true };
    case 'radio':
      return { value: value === w.buttonValue };
    case 'choice':
      // An array on purpose: PDF.js does `value.includes(exportValue)`, which on a string would
      // be a substring match.
      return { value: Array.isArray(value) ? value : value === '' ? [] : [String(value)] };
  }
}

function readDom(w: Widget, el: HTMLElement): FormValue | undefined {
  if (w.kind === 'text') return (el as HTMLInputElement | HTMLTextAreaElement).value;
  if (w.kind === 'checkbox') return (el as HTMLInputElement).checked;
  if (w.kind === 'radio') return (el as HTMLInputElement).checked ? w.buttonValue : undefined;
  const select = el as HTMLSelectElement;
  const selected = Array.from(select.options)
    .filter((o) => o.selected && o.value.trim() !== '')
    .map((o) => o.value);
  return w.multi ? selected : (selected[0] ?? '');
}

function writeDom(w: Widget, el: HTMLElement, value: FormValue): void {
  if (w.kind === 'text') {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    const next = Array.isArray(value) ? value.join('\n') : String(value);
    if (input.value !== next) input.value = next;
  } else if (w.kind === 'checkbox') {
    (el as HTMLInputElement).checked = value === true;
  } else if (w.kind === 'radio') {
    (el as HTMLInputElement).checked = value === w.buttonValue;
  } else {
    const select = el as HTMLSelectElement;
    const wanted = Array.isArray(value) ? value : value === '' ? [] : [String(value)];
    let any = false;
    for (const option of Array.from(select.options)) {
      option.selected = wanted.includes(option.value);
      any ||= option.selected;
    }
    if (!any) select.selectedIndex = -1;
  }
}

/** Write the desired values to PDF.js's annotationStorage and, if mounted, to the DOM inputs. */
function syncWidgets(
  widgets: Widget[],
  formValues: FormValues,
  storage: { setValue(key: string, value: object): void },
  root: HTMLElement | null,
): void {
  for (const w of widgets) {
    const value = formValues[w.name] ?? w.initial;
    storage.setValue(w.id, storageValue(w, value));
    const el = root?.querySelector<HTMLElement>(`[data-element-id="${w.id}"]`);
    if (el) writeDom(w, el, value);
  }
}

/** Offline stand-in for PDFLinkService: widgets never navigate anywhere. */
const noopLinkService = {
  externalLinkEnabled: false,
  addLinkAttributes() {},
  goToDestination() {},
  goToPage() {},
  getDestinationHash: () => '#',
  getAnchorUrl: () => '#',
  setHash() {},
  executeNamedAction() {},
  executeSetOCGState() {},
  eventBus: { dispatch() {}, on() {}, off() {} },
};

export function FormLayer({ page, viewport }: LayerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetsRef = useRef<Widget[]>([]);
  const formValues = useDocumentStore((s) => s.formValues);
  const capabilities = useDocumentStore((s) => s.doc?.capabilities);
  const interactive = !!capabilities?.editable && !!capabilities.hasAcroForm;

  // (Re)build the AnnotationLayer when the page, zoom or document changes.
  useEffect(() => {
    const div = ref.current;
    const pdfDoc = getPdfDocument();
    if (!div || !pdfDoc || !interactive) {
      widgetsRef.current = [];
      div?.replaceChildren();
      return;
    }
    let cancelled = false;
    const storage = pdfDoc.annotationStorage;

    void (async () => {
      const pdfPage = await getPdfPage(page.index);
      const annotations = (await pdfPage.getAnnotations({ intent: 'display' })).filter(
        (a: { annotationType: number }) => a.annotationType === AnnotationType.WIDGET,
      );
      if (cancelled) return;
      const widgets = annotations
        .map((a: WidgetData) => toWidget(a))
        .filter((w: Widget | null): w is Widget => w !== null);
      // PDF.js reads initial input state from the storage, so seed it from the store first.
      syncWidgets(widgets, useDocumentStore.getState().formValues, storage, null);

      const fresh = document.createElement('div');
      const flipless = viewport.clone({ dontFlip: true });
      const layer = new AnnotationLayer({
        div: fresh,
        accessibilityManager: null,
        annotationCanvasMap: null,
        annotationEditorUIManager: null,
        page: pdfPage,
        viewport: flipless,
        structTreeLayer: null,
        commentManager: null,
        linkService: noopLinkService,
        annotationStorage: storage,
      });
      await layer.render({
        viewport: flipless,
        div: fresh,
        annotations,
        page: pdfPage,
        linkService: noopLinkService as never,
        annotationStorage: storage,
        renderForms: true,
        enableScripting: false,
        hasJSActions: false,
        fieldObjects: null,
      });
      if (cancelled) return;
      // Swap atomically so a zoom change never shows a half-built layer.
      div.replaceChildren(...Array.from(fresh.childNodes));
      widgetsRef.current = widgets;
      syncWidgets(widgets, useDocumentStore.getState().formValues, storage, div);
    })().catch((err: unknown) => {
      if (!cancelled) console.error('FormLayer render failed', err);
    });

    return () => {
      cancelled = true;
    };
  }, [page.index, viewport, interactive]);

  // Undo/redo (or any store change) -> inputs.
  useEffect(() => {
    const pdfDoc = getPdfDocument();
    if (!pdfDoc || widgetsRef.current.length === 0) return;
    syncWidgets(widgetsRef.current, formValues, pdfDoc.annotationStorage, ref.current);
  }, [formValues]);

  // Inputs -> store.
  useEffect(() => {
    const div = ref.current;
    if (!div) return;
    // The formValues object we last wrote while typing in the focused text field. If the store
    // holds something else (undo, another edit) the next keystroke starts a new undo step.
    let lastTyped: FormValues | null = null;

    const widgetFor = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return null;
      const id = target.getAttribute('data-element-id');
      const widget = id ? widgetsRef.current.find((w) => w.id === id) : undefined;
      return widget ? { widget, el: target } : null;
    };

    const onInput = (event: Event) => {
      const hit = widgetFor(event.target);
      if (!hit || hit.widget.kind !== 'text') return;
      const value = readDom(hit.widget, hit.el);
      if (value === undefined) return;
      const store = useDocumentStore.getState();
      if (lastTyped !== null && store.formValues === lastTyped) {
        // Same focus session: update in place, no extra undo step.
        const next = { ...store.formValues, [hit.widget.name]: value };
        useDocumentStore.setState({ formValues: next });
        lastTyped = next;
      } else {
        store.setFormValue(hit.widget.name, value);
        lastTyped = useDocumentStore.getState().formValues;
      }
    };

    const onChange = (event: Event) => {
      const hit = widgetFor(event.target);
      if (!hit || hit.widget.kind === 'text') return;
      const value = readDom(hit.widget, hit.el);
      if (value !== undefined) useDocumentStore.getState().setFormValue(hit.widget.name, value);
    };

    const onFocusChange = () => {
      lastTyped = null;
    };

    div.addEventListener('input', onInput);
    div.addEventListener('change', onChange);
    div.addEventListener('focusin', onFocusChange);
    div.addEventListener('focusout', onFocusChange);
    return () => {
      div.removeEventListener('input', onInput);
      div.removeEventListener('change', onChange);
      div.removeEventListener('focusin', onFocusChange);
      div.removeEventListener('focusout', onFocusChange);
    };
  }, []);

  const scale = viewport.scale;
  return (
    <div
      ref={ref}
      className="page-layer form-layer annotationLayer"
      data-testid="form-layer"
      style={
        {
          '--scale-factor': scale,
          '--total-scale-factor': scale,
        } as React.CSSProperties
      }
    />
  );
}
