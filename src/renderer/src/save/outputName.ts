/**
 * Default Save As location: `<source dir>/<name>-signed.pdf`. `sourcePath` may use either
 * separator; with a bare file name (no directory) only the name is suggested.
 */
export function defaultOutputPath(sourcePath: string): string {
  const cut = Math.max(sourcePath.lastIndexOf('/'), sourcePath.lastIndexOf('\\'));
  const dir = sourcePath.slice(0, cut + 1);
  const name = sourcePath.slice(cut + 1).replace(/\.pdf$/i, '') || 'document';
  return `${dir}${name}-signed.pdf`;
}

/** Last path segment of a path with either separator. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
