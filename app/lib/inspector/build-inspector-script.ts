import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Ordered list of inspector module files that get concatenated into a single IIFE.
 * Core must load first, then error capture, then screenshot capture.
 */
const MODULE_FILES = [
  'public/inspector/inspector-core.js',
  'public/inspector/error-capture.js',
  'public/inspector/screenshot-capture.js',
] as const;

let cachedScript = '';
let hasBuilt = false;

/**
 * Reads the inspector module files from `public/inspector/` and concatenates
 * them into a single IIFE string suitable for injection into the preview iframe.
 *
 * Uses `process.cwd()` to resolve paths (consistent with existing server-side
 * file resolution in `local-filesystem.ts`).
 *
 * @returns The concatenated IIFE string, or an empty string if any file is missing.
 */
export function buildInspectorScript(): string {
  try {
    const root = process.cwd();
    const parts: string[] = [];

    for (const file of MODULE_FILES) {
      const fullPath = join(root, file);
      const content = readFileSync(fullPath, 'utf-8');
      parts.push(content);
    }

    const script = `(function() {\n${parts.join('\n')}\n})();`;

    cachedScript = script;
    hasBuilt = true;

    return script;
  } catch {
    cachedScript = '';
    hasBuilt = true;

    return '';
  }
}

/**
 * Returns the inspector script, building it lazily on the first call.
 *
 * In development mode the source files are re-read on every call so that
 * changes to `public/inspector/*.js` are picked up without a server restart.
 * In production the script is built once and cached.
 */
export function getInspectorScript(): string {
  const isDev = process.env.NODE_ENV !== 'production';

  if (!hasBuilt || isDev) {
    buildInspectorScript();
  }

  return cachedScript;
}

/**
 * Returns `true` if the inspector script was successfully built
 * (i.e. all three module files were found and concatenated).
 */
export function isInspectorAvailable(): boolean {
  return getInspectorScript().length > 0;
}

/* ── html2canvas local bundle ───────────────────────────────────────────── */

let cachedHtml2Canvas = '';
let hasLoadedHtml2Canvas = false;

/**
 * Reads the minified html2canvas bundle from `node_modules` and caches it.
 * Returns the script content as a string, or an empty string if the file
 * cannot be resolved (e.g. missing dependency).
 */
export function getHtml2CanvasScript(): string {
  if (!hasLoadedHtml2Canvas) {
    try {
      const html2canvasPath = require.resolve('html2canvas/dist/html2canvas.min.js');
      cachedHtml2Canvas = readFileSync(html2canvasPath, 'utf-8');
    } catch {
      cachedHtml2Canvas = '';
    }

    hasLoadedHtml2Canvas = true;
  }

  return cachedHtml2Canvas;
}
