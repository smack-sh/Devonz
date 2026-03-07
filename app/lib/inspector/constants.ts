/**
 * Shared constants for the Element Inspector subsystem.
 *
 * Centralises magic numbers previously scattered across Inspector
 * components, making them discoverable and easy to tune.
 *
 * @module inspector/constants
 */

/** Duration (ms) to show "Copied!" feedback after a clipboard action. */
export const COPY_FEEDBACK_TIMEOUT_MS = 2000;

/** Duration (ms) to show feedback after copying a color value. */
export const COLOR_COPY_TIMEOUT_MS = 1500;

/** Debounce delay (ms) for click-action feedback animations. */
export const CLICK_DEBOUNCE_MS = 200;

/** Maximum character length for editable text content. */
export const TEXT_MAX_LENGTH = 2000;

/** Number of characters shown in text previews before truncation. */
export const TEXT_PREVIEW_LENGTH = 50;

/** Maximum number of unique colours retained in the page palette. */
export const MAX_PALETTE_COLORS = 16;
