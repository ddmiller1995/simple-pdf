import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ImageOverlay, TextOverlay } from '@shared/types';
import {
  centeredRect,
  clampInto,
  moveRect,
  pageBounds,
  resizeAspect,
  resizeWidth,
  scaleRectFrom,
  scaleTextDrag,
} from '@renderer/overlays/geometry';
import { autoFit, sizeAtWidth } from '@renderer/overlays/textFit';
import { useEditStore } from '@renderer/overlays/editStore';
import { useDocumentStore, type DocState } from '@renderer/state/documentStore';
import { lineHeight } from '@renderer/pdf/textLayout';
import { useNotoSans } from '../helpers/font';

const B = pageBounds(600, 800);

describe('text scaling', () => {
  const start = { left: 200, top: 300, width: 100, height: 40 };

  it('scaleRectFrom keeps the opposite corner fixed', () => {
    expect(scaleRectFrom(start, 'se', 2)).toEqual({ left: 200, top: 300, width: 200, height: 80 });
    expect(scaleRectFrom(start, 'nw', 2)).toEqual({ left: 100, top: 260, width: 200, height: 80 });
    expect(scaleRectFrom(start, 'ne', 0.5)).toEqual({ left: 200, top: 320, width: 50, height: 20 });
    expect(scaleRectFrom(start, 'sw', 0.5)).toEqual({ left: 250, top: 300, width: 50, height: 20 });
  });

  it('a diagonal corner drag scales font and box together', () => {
    const r = scaleTextDrag(start, 12, 'se', 100, 40, B);
    expect(r.factor).toBeCloseTo(2);
    expect(r.fontSize).toBeCloseTo(24);
    expect(r.rect).toEqual({ left: 200, top: 300, width: 200, height: 80 });
    const shrink = scaleTextDrag(start, 12, 'nw', 50, 20, B);
    expect(shrink.factor).toBeCloseTo(0.5);
    // Opposite (south-east) corner stays at (300, 340).
    expect(shrink.rect.left + shrink.rect.width).toBeCloseTo(300);
    expect(shrink.rect.top + shrink.rect.height).toBeCloseTo(340);
  });

  it('clamps the font size to 6..96pt', () => {
    expect(scaleTextDrag(start, 12, 'se', -1000, -1000, B).fontSize).toBeCloseTo(6);
    const big = scaleTextDrag({ left: 0, top: 0, width: 20, height: 10 }, 12, 'se', 5000, 5000, B);
    expect(big.fontSize).toBeLessThanOrEqual(96);
    const huge = scaleTextDrag({ left: 0, top: 0, width: 20, height: 10 }, 40, 'se', 500, 500, B);
    expect(huge.fontSize).toBeCloseTo(96);
  });

  it('resizeWidth also accepts the edge handles', () => {
    expect(resizeWidth(start, 'e', 30, B, 20)).toEqual({ left: 200, width: 130 });
    expect(resizeWidth(start, 'w', 30, B, 20)).toEqual({ left: 230, width: 70 });
  });
});

describe('geometry', () => {
  it('moveRect clamps to the page on every side', () => {
    const r = { left: 100, top: 100, width: 50, height: 30 };
    expect(moveRect(r, 10, -20, B)).toEqual({ left: 110, top: 80, width: 50, height: 30 });
    expect(moveRect(r, -500, -500, B)).toMatchObject({ left: 0, top: 0 });
    expect(moveRect(r, 5000, 5000, B)).toMatchObject({ left: 550, top: 770 });
  });

  it('clampInto pins an oversized rect to the top-left', () => {
    expect(clampInto({ left: 40, top: 40, width: 700, height: 900 }, B)).toMatchObject({
      left: 0,
      top: 0,
    });
  });

  it('centeredRect centres on the point and clamps near edges', () => {
    expect(centeredRect(300, 400, 100, 40, B)).toEqual({ left: 250, top: 380, width: 100, height: 40 });
    expect(centeredRect(5, 5, 100, 40, B)).toMatchObject({ left: 0, top: 0 });
    expect(centeredRect(599, 799, 100, 40, B)).toMatchObject({ left: 500, top: 760 });
  });

  it('resizeAspect keeps the aspect and the opposite corner fixed', () => {
    const start = { left: 100, top: 100, width: 200, height: 100 };
    const se = resizeAspect(start, 'se', 100, 0, B, 10);
    expect(se.width / se.height).toBeCloseTo(2);
    expect(se.left).toBe(100);
    expect(se.top).toBe(100);
    const nw = resizeAspect(start, 'nw', -40, -20, B, 10);
    expect(nw.width / nw.height).toBeCloseTo(2);
    expect(nw.left + nw.width).toBeCloseTo(300);
    expect(nw.top + nw.height).toBeCloseTo(200);
    expect(nw.width).toBeGreaterThan(200);
  });

  it('resizeAspect respects the minimum width and the page edge', () => {
    const start = { left: 100, top: 100, width: 200, height: 100 };
    const tiny = resizeAspect(start, 'se', -1000, -1000, B, 30);
    expect(tiny.width).toBeCloseTo(30);
    const huge = resizeAspect(start, 'se', 5000, 5000, B, 30);
    expect(huge.left + huge.width).toBeLessThanOrEqual(600 + 1e-9);
    expect(huge.top + huge.height).toBeLessThanOrEqual(800 + 1e-9);
    expect(huge.width / huge.height).toBeCloseTo(2);
  });

  it('resizeWidth moves one edge only', () => {
    const start = { left: 100, top: 100, width: 200, height: 40 };
    expect(resizeWidth(start, 'se', 50, B, 20)).toEqual({ left: 100, width: 250 });
    expect(resizeWidth(start, 'nw', 50, B, 20)).toEqual({ left: 150, width: 150 });
    expect(resizeWidth(start, 'ne', -1000, B, 20)).toEqual({ left: 100, width: 20 });
    expect(resizeWidth(start, 'sw', -1000, B, 20)).toEqual({ left: 0, width: 300 });
  });
});

describe('textFit', () => {
  beforeAll(useNotoSans);

  it('grows to the widest paragraph and counts lines', () => {
    const one = autoFit('Hello', 12, 10, 500);
    expect(one.lines).toEqual(['Hello']);
    expect(one.height).toBeCloseTo(lineHeight(12));
    const two = autoFit('Hello\nWorld, longer', 12, 10, 500);
    expect(two.lines).toHaveLength(2);
    expect(two.width).toBeGreaterThan(one.width);
  });

  it('wraps when the room to the page edge runs out', () => {
    const fit = autoFit('alpha beta gamma delta epsilon', 12, 10, 60);
    expect(fit.width).toBe(60);
    expect(fit.lines.length).toBeGreaterThan(1);
    expect(sizeAtWidth('x', 12, 60).height).toBeCloseTo(lineHeight(12));
  });

  it('never shrinks below the minimum width', () => {
    expect(autoFit('', 12, 48, 500).width).toBe(48);
  });
});

describe('edit session and undo history', () => {
  const doc: DocState = {
    fileName: 'a.pdf',
    sourcePath: '/tmp/a.pdf',
    sourceBytes: new Uint8Array([1]),
    pages: [{ index: 0, widthPt: 612, heightPt: 792, rotation: 0 }],
    capabilities: { editable: true, hasAcroForm: false },
  };
  const draft = (id = 't1'): TextOverlay => ({
    kind: 'text',
    id,
    pageIndex: 0,
    rect: { x: 10, y: 10, width: 48, height: 14.4 },
    text: '',
    fontSize: 12,
    color: [0, 0, 0],
  });
  const docs = useDocumentStore;
  const edit = useEditStore;

  beforeEach(() => {
    edit.getState().cancel();
    docs.getState().loadDocument(doc);
  });

  it('an empty new box never reaches the document', () => {
    edit.getState().startNew(draft());
    edit.getState().commit();
    expect(docs.getState().overlays).toHaveLength(0);
    expect(docs.getState().history.past).toHaveLength(0);
  });

  it('typing is ONE undo step per session', () => {
    edit.getState().startNew(draft());
    for (const text of ['H', 'He', 'Hel', 'Hell', 'Hello']) edit.getState().update({ text });
    edit.getState().commit();
    expect(docs.getState().overlays).toHaveLength(1);
    expect(docs.getState().history.past).toHaveLength(1);
    docs.getState().undo();
    expect(docs.getState().overlays).toHaveLength(0);
    docs.getState().redo();
    expect((docs.getState().overlays[0] as TextOverlay).text).toBe('Hello');
  });

  it('editing an existing box is one step; emptying it removes it', () => {
    docs.getState().addOverlay({ ...draft(), text: 'old' });
    edit.getState().startEdit(docs.getState().overlays[0] as TextOverlay);
    edit.getState().update({ text: 'ol' });
    edit.getState().update({ text: 'new' });
    edit.getState().commit();
    expect(docs.getState().history.past).toHaveLength(2);
    expect((docs.getState().overlays[0] as TextOverlay).text).toBe('new');

    edit.getState().startEdit(docs.getState().overlays[0] as TextOverlay);
    edit.getState().update({ text: '  ' });
    edit.getState().commit();
    expect(docs.getState().overlays).toHaveLength(0);
  });

  it('an unchanged edit session records nothing', () => {
    docs.getState().addOverlay({ ...draft(), text: 'same' });
    const before = docs.getState().history.past.length;
    edit.getState().startEdit(docs.getState().overlays[0] as TextOverlay);
    edit.getState().commit();
    expect(docs.getState().history.past).toHaveLength(before);
  });

  it('a move is one updateOverlay step and undo restores the rect', () => {
    const img: ImageOverlay = {
      kind: 'image',
      id: 'i1',
      pageIndex: 0,
      rect: { x: 10, y: 10, width: 100, height: 40 },
      signatureId: 's',
      pngDataUrl: 'data:image/png;base64,AAAA',
    };
    docs.getState().addOverlay(img);
    docs.getState().updateOverlay('i1', { rect: { x: 50, y: 60, width: 100, height: 40 } });
    expect(docs.getState().overlays[0]!.rect.x).toBe(50);
    docs.getState().undo();
    expect(docs.getState().overlays[0]!.rect.x).toBe(10);
  });
});

describe('stamp mode', () => {
  const sig = {
    id: 's1',
    label: 'Sig',
    kind: 'signature' as const,
    createdAt: '',
    pngDataUrl: 'data:image/png;base64,AA==',
  };

  it('arming selects the Select tool; switching tool disarms', async () => {
    const { useStampStore } = await import('@renderer/overlays/stampStore');
    useDocumentStore.getState().setTool('text');
    useStampStore.getState().arm(sig);
    expect(useDocumentStore.getState().tool).toBe('select');
    expect(useStampStore.getState().armed).toEqual(sig);
    useDocumentStore.getState().setTool('text');
    expect(useStampStore.getState().armed).toBeNull();
    useStampStore.getState().arm(sig);
    useStampStore.getState().disarm();
    expect(useStampStore.getState().armed).toBeNull();
  });
});
