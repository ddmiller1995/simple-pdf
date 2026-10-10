import type { Corner, Edge } from './geometry';

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];
const EDGES: Edge[] = ['w', 'e'];

const LABELS: Record<Corner | Edge, string> = {
  nw: 'Scale from top left',
  ne: 'Scale from top right',
  sw: 'Scale from bottom left',
  se: 'Scale from bottom right',
  w: 'Change width from left',
  e: 'Change width from right',
};

/**
 * Corner handles around the selected overlay (the outline itself is CSS on the item). Text boxes
 * also get a middle handle on the left and right edges (`edges`), which changes the width only.
 */
export function SelectionHandles({
  onHandleDown,
  edges = false,
}: {
  onHandleDown: (handle: Corner | Edge, e: React.PointerEvent<HTMLElement>) => void;
  edges?: boolean;
}) {
  const handles: (Corner | Edge)[] = edges ? [...CORNERS, ...EDGES] : CORNERS;
  return (
    <>
      {handles.map((h) => (
        <span
          key={h}
          className={`sel-handle sel-${h}`}
          data-handle={h}
          title={LABELS[h]}
          onPointerDown={(e) => onHandleDown(h, e)}
        />
      ))}
    </>
  );
}
