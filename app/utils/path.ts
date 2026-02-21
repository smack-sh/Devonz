// Browser-compatible path utilities
import type { ParsedPath } from 'path';
import pathBrowserify from 'path-browserify';

/**
 * A browser-compatible path utility that mimics Node's path module
 * Using path-browserify for consistent behavior in browser environments
 */
export const path = {
  join: (...paths: string[]): string => pathBrowserify.join(...paths),
  dirname: (path: string): string => pathBrowserify.dirname(path),
  basename: (path: string, ext?: string): string => pathBrowserify.basename(path, ext),
  extname: (path: string): string => pathBrowserify.extname(path),
  relative: (from: string, to: string): string => pathBrowserify.relative(from, to),
  isAbsolute: (path: string): boolean => pathBrowserify.isAbsolute(path),
  normalize: (path: string): string => pathBrowserify.normalize(path),
  parse: (path: string): ParsedPath => pathBrowserify.parse(path),
  format: (pathObject: ParsedPath): string => pathBrowserify.format(pathObject),
} as const;

/**
 * Convert a file/folder path to a path relative to a base directory.
 *
 * Paths coming from the AI message parser are typically already relative
 * (e.g. `src/App.tsx`).  `path.relative('/home/project', 'src/App.tsx')`
 * produces `../../src/App.tsx` — a traversal path the server rejects.
 *
 * This helper handles three path forms:
 *   1. Absolute with baseDir prefix (`/home/project/src/App.tsx`) → `path.relative()`
 *   2. Already relative (`src/App.tsx`) → returned as-is
 *   3. Absolute WITHOUT baseDir prefix (`/src/App.tsx`) → strip leading slashes
 *      This third case occurs when replaying old chat history that stored
 *      absolute paths before the path-normalization fix was applied.
 */
export function toRelativePath(baseDir: string, filePath: string): string {
  if (filePath.startsWith(baseDir)) {
    return path.relative(baseDir, filePath);
  }

  /*
   * Strip leading slashes from absolute paths that don't belong to baseDir.
   * e.g. "/src/app/app.component.css" → "src/app/app.component.css"
   */
  if (filePath.startsWith('/')) {
    return filePath.replace(/^\/+/, '');
  }

  return filePath;
}
