/**
 * Shared CSS selector builder for the Element Inspector.
 *
 * Builds a human-readable `tag#id.class` pattern from an `ElementInfo`
 * object, with sanitization applied to prevent prompt-injection and
 * invalid selector characters.
 *
 * @module utils/selector
 */

import type { ElementInfo } from '~/lib/inspector/types';
import { sanitizeSelectorPart } from '~/utils/sanitize';

/**
 * Build a sanitized CSS-like selector string from an inspector element.
 *
 * The returned selector follows the pattern `tag#id.firstClass`, where
 * each part is sanitized to strip characters that could break prompt
 * parsing or CSS selector syntax.
 *
 * @param element - The inspector element to build a selector from.
 * @returns A sanitized selector string, e.g. `div#main.container`.
 *
 * @example
 * ```ts
 * const selector = buildElementSelector(element);
 * // "button#submit.primary"
 * ```
 */
export function buildElementSelector(element: ElementInfo): string {
  const parts = [sanitizeSelectorPart(element.tagName.toLowerCase())];

  if (element.id) {
    parts.push(`#${sanitizeSelectorPart(element.id)}`);
  }

  if (element.className) {
    const firstClass = element.className.split(' ')[0];

    if (firstClass) {
      parts.push(`.${sanitizeSelectorPart(firstClass)}`);
    }
  }

  return parts.join('');
}
