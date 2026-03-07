/**
 * Sanitization utilities for user-controlled text before AI prompt injection.
 *
 * @module utils/sanitize
 */

/**
 * Sanitize user-controlled text before injecting into AI prompts.
 * Strips control characters, limits length, and escapes markdown.
 */
export function sanitizeForPrompt(input: string, maxLength = 200): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Strip control characters (except newlines)
  let sanitized = input.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Escape markdown-like sequences that could manipulate prompt parsing
  sanitized = sanitized.replace(/```/g, '\\`\\`\\`');

  // Truncate to max length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength) + '…';
  }

  return sanitized;
}

/**
 * Sanitize a CSS selector part (tag name, class, id).
 * Only allows alphanumeric, hyphens, underscores, and dots.
 */
export function sanitizeSelectorPart(input: string, maxLength = 100): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  return input.replace(/[^a-zA-Z0-9\-_.\s#]/g, '').slice(0, maxLength);
}

/**
 * Sanitize a CSS property value before injection.
 * Strips dangerous CSS functions and limits length.
 */
export function sanitizeCSSValue(input: string, maxLength = 500): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Remove potentially dangerous CSS functions
  let sanitized = input.replace(/expression\s*\(/gi, '');
  sanitized = sanitized.replace(/url\s*\(\s*['"]?javascript:/gi, '');

  return sanitized.slice(0, maxLength);
}
