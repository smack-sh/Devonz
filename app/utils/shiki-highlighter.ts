/**
 * Shared Shiki syntax highlighter singleton.
 *
 * Consolidates the three independent `createHighlighter` / `codeToHtml` call
 * sites (CodeBlock, Artifact, ToolInvocations) into one lazily-initialised
 * instance so that Shiki's 200 KB+ language bundle is loaded exactly once.
 */
import {
  createHighlighter,
  bundledLanguages,
  isSpecialLang,
  type BundledLanguage,
  type BundledTheme,
  type HighlighterGeneric,
  type SpecialLanguage,
} from 'shiki';

/* ------------------------------------------------------------------ */
/*  Merged language set used across all consumers                     */
/* ------------------------------------------------------------------ */

/**
 * Artifact.tsx uses a small explicit list; ToolInvocations.tsx only needs
 * `json`. CodeBlock.tsx relies on the full `bundledLanguages` map at
 * runtime via `codeToHtml`.  We pre-load the Artifact subset eagerly and
 * let CodeBlock load additional languages on demand through `codeToHtml`
 * (which handles auto-loading).
 */
const PRELOADED_LANGS: BundledLanguage[] = [
  'shell',
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'css',
  'html',
  'json',
  'markdown',
  'python',
];

const THEMES: BundledTheme[] = ['light-plus', 'dark-plus'];

/* ------------------------------------------------------------------ */
/*  Singleton with HMR preservation                                   */
/* ------------------------------------------------------------------ */

/** Preserve the highlighter instance across Vite HMR refreshes. */
let _highlighter: HighlighterGeneric<BundledLanguage, BundledTheme> | undefined =
  ((import.meta.hot?.data as Record<string, unknown> | undefined)?.sharedHighlighter as
    | HighlighterGeneric<BundledLanguage, BundledTheme>
    | undefined) ?? undefined;

let _initPromise: Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> | undefined;

/**
 * Returns the shared Shiki highlighter, creating it on first call.
 * Subsequent calls return the cached instance.
 */
export async function getSharedHighlighter(): Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> {
  if (_highlighter) {
    return _highlighter;
  }

  if (!_initPromise) {
    _initPromise = createHighlighter({
      langs: PRELOADED_LANGS,
      themes: THEMES,
    }).then((h) => {
      _highlighter = h;

      if (import.meta.hot) {
        (import.meta.hot.data as Record<string, unknown>).sharedHighlighter = h;
      }

      return h;
    });
  }

  return _initPromise;
}

/* ------------------------------------------------------------------ */
/*  Re-exports used by CodeBlock (keeps its API unchanged)            */
/* ------------------------------------------------------------------ */

export { bundledLanguages, isSpecialLang };
export type { BundledLanguage, BundledTheme, HighlighterGeneric, SpecialLanguage };
