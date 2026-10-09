import { describe, expect, it } from 'vitest';
import { clampZoom, fitWidthZoom, zoomIn, zoomOut } from '../../src/renderer/src/viewer/zoom';

describe('zoom helpers', () => {
  it('steps through presets and clamps to 50-400%', () => {
    expect(zoomIn(1)).toBe(1.25);
    expect(zoomIn(1.1)).toBe(1.25);
    expect(zoomOut(1)).toBe(0.75);
    expect(zoomOut(0.9)).toBe(0.75);
    expect(zoomIn(4)).toBe(4);
    expect(zoomOut(0.5)).toBe(0.5);
    expect(clampZoom(10)).toBe(4);
    expect(clampZoom(0.1)).toBe(0.5);
  });

  it('fits the widest page to the available width', () => {
    expect(fitWidthZoom(612, 612)).toBe(1);
    expect(fitWidthZoom(918, 612)).toBe(1.5);
    expect(fitWidthZoom(0, 612)).toBe(1);
    expect(fitWidthZoom(100, 612)).toBe(0.5);
  });
});
