import { useEffect, useState } from 'react';
import { useDocumentStore } from '../state/documentStore';
import { INITIALS_WIDTH_PT, SIGNATURE_WIDTH_PT } from './placement';
import { useStampStore } from './stampStore';

/** Esc or a click on the toolbar cancels stamp mode. */
export function useStampCancel(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && useStampStore.getState().armed) {
        useStampStore.getState().disarm();
      }
    };
    const onDown = (e: PointerEvent): void => {
      if (!useStampStore.getState().armed) return;
      if ((e.target as HTMLElement | null)?.closest?.('.toolbar')) {
        useStampStore.getState().disarm();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, []);
}

/** Semi-transparent preview of the armed signature at its default size, following the cursor. */
export function StampGhost() {
  const armed = useStampStore((s) => s.armed);
  const zoom = useDocumentStore((s) => s.zoom);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!armed) {
      setPos(null);
      return;
    }
    const onMove = (e: PointerEvent): void => {
      const over = (e.target as HTMLElement | null)?.closest?.('.page-view');
      setPos(over ? { x: e.clientX, y: e.clientY } : null);
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [armed]);

  if (!armed || !pos) return null;
  const widthPt = armed.kind === 'initials' ? INITIALS_WIDTH_PT : SIGNATURE_WIDTH_PT;
  return (
    <img
      className="stamp-ghost"
      data-testid="stamp-ghost"
      src={armed.pngDataUrl}
      alt=""
      style={{ left: pos.x, top: pos.y, width: widthPt * zoom }}
    />
  );
}
