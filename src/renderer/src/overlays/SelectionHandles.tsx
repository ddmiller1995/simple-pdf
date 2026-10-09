import type { Corner } from './geometry';

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];

/** Four corner handles around the selected overlay (the outline itself is CSS on the item). */
export function SelectionHandles({
  onHandleDown,
}: {
  onHandleDown: (corner: Corner, e: React.PointerEvent<HTMLElement>) => void;
}) {
  return (
    <>
      {CORNERS.map((c) => (
        <span
          key={c}
          className={`sel-handle sel-${c}`}
          data-handle={c}
          onPointerDown={(e) => onHandleDown(c, e)}
        />
      ))}
    </>
  );
}
