import { useEffect, useRef } from 'react';
import type { PageViewport } from 'pdfjs-dist';
import { pdfRectToScreenRect, screenRectToPdfRect } from '../pdf/coords';
import { useEditStore } from './editStore';
import { autoFit } from './textFit';
import { textStyle } from './TextBox';

/**
 * The textarea shown while a box is being typed into. It fills the (auto-growing) item box, which
 * is positioned by OverlayLayer from the session's rect.
 */
export function TextEditor({ viewport }: { viewport: PageViewport }) {
  const session = useEditStore((s) => s.session);
  const ref = useRef<HTMLTextAreaElement>(null);
  const minWidthPt = useRef(0);
  const scale = viewport.scale;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    const s = useEditStore.getState().session;
    if (s) minWidthPt.current = pdfRectToScreenRect(viewport, s.initialRect).width / scale;
    // Only on mount: the same session keeps the same textarea.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!session) return null;
  const o = session.overlay;

  const onChange = (text: string): void => {
    const start = pdfRectToScreenRect(viewport, o.rect);
    const room = (viewport.width - start.left) / scale;
    const fit = autoFit(text, o.fontSize, minWidthPt.current, room);
    useEditStore.getState().update({
      text,
      rect: screenRectToPdfRect(viewport, {
        left: start.left,
        top: start.top,
        width: fit.width * scale,
        height: fit.height * scale,
      }),
    });
  };

  return (
    <textarea
      ref={ref}
      className="text-editor"
      data-testid="text-editor"
      style={textStyle(o, scale)}
      value={o.text}
      spellCheck={false}
      wrap="soft"
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => useEditStore.getState().commit()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}
