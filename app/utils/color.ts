/**
 * Shared color utility functions for the UI.
 *
 * @module utils/color
 */

/** Convert any CSS color string (rgb, rgba, hex shorthand) to a full #rrggbb hex string. */
export const toHex = (color: string): string => {
  // If already hex, return as-is (expand 3-char shorthand to 6-char)
  if (color.startsWith('#')) {
    return color.length === 4 ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}` : color;
  }

  // Handle rgb/rgba
  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);

  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10).toString(16).padStart(2, '0');
    const g = parseInt(rgbMatch[2], 10).toString(16).padStart(2, '0');
    const b = parseInt(rgbMatch[3], 10).toString(16).padStart(2, '0');

    return `#${r}${g}${b}`;
  }

  return color;
};

/**
 * Determines whether a hex color is "light" (better with dark text).
 * Uses the relative luminance formula.
 */
export const isLightColor = (hex: string): boolean => {
  const clean = hex.replace('#', '');

  if (clean.length < 6) {
    return false;
  }

  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance > 0.5;
};
