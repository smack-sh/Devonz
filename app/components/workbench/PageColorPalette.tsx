import { memo, useState, useCallback } from 'react';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('ColorPalette');

interface PageColorPaletteProps {
  colors: string[];
  onColorSelect?: (color: string) => void;
}

// Function to convert color to hex format
const toHex = (color: string): string => {
  // If already hex, return as is
  if (color.startsWith('#')) {
    return color.length === 4 ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}` : color;
  }

  // Handle rgb/rgba
  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);

  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
    const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
    const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');

    return `#${r}${g}${b}`;
  }

  return color;
};

// Check if color is light or dark
const isLightColor = (color: string): boolean => {
  const hex = toHex(color).replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance > 0.5;
};

export const PageColorPalette = memo(({ colors, onColorSelect }: PageColorPaletteProps) => {
  const [copiedColor, setCopiedColor] = useState<string | null>(null);

  const handleCopyColor = useCallback(async (color: string) => {
    const hex = toHex(color);

    try {
      await navigator.clipboard.writeText(hex);
      setCopiedColor(hex);
      setTimeout(() => setCopiedColor(null), 1500);
    } catch {
      logger.error('Failed to copy color');
    }
  }, []);

  const handleSelectColor = useCallback(
    (color: string) => {
      onColorSelect?.(toHex(color));
    },
    [onColorSelect],
  );

  if (!colors || colors.length === 0) {
    return (
      <div className="text-center py-4 text-devonz-elements-textTertiary text-xs">
        <div className="i-ph:palette w-6 h-6 mx-auto mb-2 opacity-40" />
        <p>No colors detected</p>
      </div>
    );
  }

  // Deduplicate and limit colors
  const uniqueColors = [...new Set(colors.map((c) => toHex(c)))].slice(0, 16);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] text-devonz-elements-textTertiary uppercase tracking-wide">
          <span className="i-ph:palette w-3 h-3" />
          Page Colors ({uniqueColors.length})
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {uniqueColors.map((color, index) => {
          const hex = toHex(color);
          const isLight = isLightColor(color);
          const isCopied = copiedColor === hex;

          return (
            <div key={`${color}-${index}`} className="flex flex-col items-center gap-1">
              <button
                onClick={() => handleCopyColor(color)}
                onDoubleClick={() => handleSelectColor(color)}
                className="w-10 h-10 rounded-lg border-2 transition-all hover:scale-110 hover:shadow-lg relative group"
                style={{
                  backgroundColor: color,
                  borderColor: isLight ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.2)',
                }}
                title={`${hex}\nClick to copy, double-click to use`}
              >
                {isCopied && (
                  <span
                    className={`absolute inset-0 flex items-center justify-center text-xs font-bold ${
                      isLight ? 'text-gray-800' : 'text-white'
                    }`}
                  >
                    ✓
                  </span>
                )}
                <span
                  className={`absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ${
                    isLight ? 'text-gray-800' : 'text-white'
                  }`}
                >
                  <span className="i-ph:copy w-4 h-4" />
                </span>
              </button>
              <span className="text-[9px] text-devonz-elements-textTertiary font-mono truncate max-w-[44px]">
                {hex.slice(1).toUpperCase()}
              </span>
            </div>
          );
        })}
      </div>

      <div className="pt-2 border-t border-devonz-elements-borderColor">
        <p className="text-[10px] text-devonz-elements-textTertiary text-center">Click to copy • Double-click to apply</p>
      </div>
    </div>
  );
});

PageColorPalette.displayName = 'PageColorPalette';
