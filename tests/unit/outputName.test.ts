import { describe, expect, it } from 'vitest';
import { baseName, defaultOutputPath } from '../../src/renderer/src/save/outputName';

describe('defaultOutputPath', () => {
  it('suggests <dir>/<name>-signed.pdf', () => {
    expect(defaultOutputPath('/Users/me/Docs/lease.pdf')).toBe('/Users/me/Docs/lease-signed.pdf');
  });
  it('handles Windows separators and upper-case extensions', () => {
    expect(defaultOutputPath('C:\\Docs\\Form.PDF')).toBe('C:\\Docs\\Form-signed.pdf');
  });
  it('handles a bare file name and names without .pdf', () => {
    expect(defaultOutputPath('form.pdf')).toBe('form-signed.pdf');
    expect(defaultOutputPath('/a/b/report')).toBe('/a/b/report-signed.pdf');
  });
  it('baseName takes the last segment', () => {
    expect(baseName('/a/b/c.pdf')).toBe('c.pdf');
    expect(baseName('C:\\a\\c.pdf')).toBe('c.pdf');
  });
});
