import { useState, useCallback, memo } from 'react';
import type { ElementInfo } from './Inspector';
import { BoxModelEditor } from './BoxModelEditor';
import { AiQuickActions } from './AIQuickActions';
import { ElementTreeNavigator } from './ElementTreeNavigator';
import { PageColorPalette } from './PageColorPalette';
import { BulkStyleSelector } from './BulkStyleSelector';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('Inspector');

interface BulkTarget {
  value: string;
  label: string;
  selector: string;
}

interface BulkStyleChange {
  selector: string;
  property: string;
  value: string;
}

const RELEVANT_STYLE_PROPS = [
  'color',
  'background-color',
  'background',
  'font-size',
  'font-weight',
  'font-family',
  'text-align',
  'padding',
  'margin',
  'border',
  'border-radius',
  'width',
  'height',
  'display',
  'position',
  'flex-direction',
  'justify-content',
  'align-items',
  'gap',
];

const getRelevantStyles = (styles: Record<string, string>): Record<string, string> => {
  return RELEVANT_STYLE_PROPS.reduce(
    (acc, prop) => {
      const value = styles[prop];

      if (value) {
        acc[prop] = value;
      }

      return acc;
    },
    {} as Record<string, string>,
  );
};

const isColorProperty = (prop: string): boolean => {
  return prop.includes('color') || prop === 'background' || prop.includes('border');
};

const parseColorFromValue = (value: string): string | null => {
  // Try to extract hex color
  const hexMatch = value.match(/#([0-9a-fA-F]{3,8})/);

  if (hexMatch) {
    return hexMatch[0];
  }

  // Try to extract rgb/rgba
  const rgbMatch = value.match(/rgba?\([^)]+\)/);

  if (rgbMatch) {
    return rgbMatch[0];
  }

  return null;
};

interface InspectorPanelProps {
  selectedElement: ElementInfo | null;
  isVisible: boolean;
  onClose: () => void;
  onStyleChange?: (property: string, value: string) => void;
  onTextChange?: (text: string) => void;
  onApplyWithAI?: (changes: { element: ElementInfo; styles: Record<string, string>; text?: string }) => void;
  onDeleteElement?: (element: ElementInfo) => void;
  onAIAction?: (message: string) => void;
  onSelectFromTree?: (selector: string) => void;
  onRevert?: () => void;
  onBulkStyleChange?: (selector: string, property: string, value: string) => void;
  onBulkRevert?: (selector: string) => void;
  bulkAffectedCount?: number;
  accumulatedBulkChanges?: BulkStyleChange[];
  onApplyBulkCSS?: () => void;
  onClearBulkChanges?: () => void;
}

export const InspectorPanel = memo(
  ({
    selectedElement,
    isVisible,
    onClose,
    onStyleChange,
    onTextChange,
    onApplyWithAI,
    onDeleteElement,
    onAIAction,
    onSelectFromTree,
    onRevert,
    onBulkStyleChange,
    onBulkRevert,
    bulkAffectedCount,
    accumulatedBulkChanges,
    onApplyBulkCSS,
    onClearBulkChanges,
  }: InspectorPanelProps) => {
    const [activeTab, setActiveTab] = useState<'styles' | 'text' | 'box' | 'ai' | 'tree' | 'colors'>('styles');
    const [editedStyles, setEditedStyles] = useState<Record<string, string>>({});
    const [editedText, setEditedText] = useState<string>('');
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
    const [bulkTarget, setBulkTarget] = useState<BulkTarget | null>(null);

    // Reset edited values when element changes
    const handleStyleChange = useCallback(
      (property: string, value: string) => {
        logger.debug('Style change:', property, value, 'bulk:', bulkTarget?.selector);
        setEditedStyles((prev) => ({ ...prev, [property]: value }));

        // If in bulk mode, apply to all matching elements
        if (bulkTarget && onBulkStyleChange) {
          onBulkStyleChange(bulkTarget.selector, property, value);
        } else {
          onStyleChange?.(property, value);
        }
      },
      [onStyleChange, onBulkStyleChange, bulkTarget],
    );

    const handleTextChange = useCallback(
      (text: string) => {
        logger.debug('Text change:', text);
        setEditedText(text);
        onTextChange?.(text);
      },
      [onTextChange],
    );

    // Check if there are any changes to apply
    const hasChanges = Object.keys(editedStyles).length > 0 || editedText.length > 0;

    // Generate CSS string from edited styles
    const generateCSS = useCallback(() => {
      if (Object.keys(editedStyles).length === 0) {
        return '';
      }

      const selector = selectedElement?.selector || selectedElement?.tagName.toLowerCase() || 'element';
      const styleLines = Object.entries(editedStyles)
        .map(([prop, value]) => `  ${prop}: ${value};`)
        .join('\n');

      return `${selector} {\n${styleLines}\n}`;
    }, [editedStyles, selectedElement]);

    // Copy CSS to clipboard
    const handleCopyCSS = useCallback(async () => {
      const css = generateCSS();

      if (!css) {
        setCopyFeedback('No changes to copy');
        setTimeout(() => setCopyFeedback(null), 2000);

        return;
      }

      try {
        await navigator.clipboard.writeText(css);
        setCopyFeedback('Copied!');
        setTimeout(() => setCopyFeedback(null), 2000);
      } catch {
        setCopyFeedback('Failed to copy');
        setTimeout(() => setCopyFeedback(null), 2000);
      }
    }, [generateCSS]);

    // Copy all computed styles to clipboard
    const handleCopyAllStyles = useCallback(async () => {
      if (!selectedElement) {
        return;
      }

      const selector = selectedElement.selector || selectedElement.tagName.toLowerCase();
      const styles = getRelevantStyles(selectedElement.styles);

      if (Object.keys(styles).length === 0) {
        setCopyFeedback('No styles to copy');
        setTimeout(() => setCopyFeedback(null), 2000);

        return;
      }

      const styleLines = Object.entries(styles)
        .map(([prop, value]) => `  ${prop}: ${value};`)
        .join('\n');

      const css = `${selector} {\n${styleLines}\n}`;

      try {
        await navigator.clipboard.writeText(css);
        setCopyFeedback('All styles copied!');
        setTimeout(() => setCopyFeedback(null), 2000);
      } catch {
        setCopyFeedback('Failed to copy');
        setTimeout(() => setCopyFeedback(null), 2000);
      }
    }, [selectedElement]);

    // Apply with AI
    const handleApplyWithAI = useCallback(() => {
      if (!selectedElement || !hasChanges) {
        return;
      }

      onApplyWithAI?.({
        element: selectedElement,
        styles: editedStyles,
        text: editedText || undefined,
      });
    }, [selectedElement, editedStyles, editedText, hasChanges, onApplyWithAI]);

    if (!isVisible || !selectedElement) {
      return null;
    }

    return (
      <div className="fixed right-4 top-20 w-80 bg-devonz-elements-background-depth-2 border border-devonz-elements-borderColor rounded-lg shadow-lg z-[9999] max-h-[calc(100vh-6rem)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-devonz-elements-borderColor bg-devonz-elements-background-depth-3">
          <div className="flex items-center gap-2">
            <div className="i-ph:cursor-click text-accent-400" />
            <h3 className="font-medium text-devonz-elements-textPrimary text-sm">Element Inspector</h3>
          </div>
          <button
            onClick={onClose}
            className="text-devonz-elements-textSecondary hover:text-devonz-elements-textPrimary transition-colors p-1 rounded hover:bg-devonz-elements-background-depth-4"
          >
            <div className="i-ph:x w-4 h-4" />
          </button>
        </div>

        {/* Element Info */}
        <div className="p-3 border-b border-devonz-elements-borderColor bg-devonz-elements-background-depth-2">
          <div className="text-sm">
            <div className="font-mono text-xs bg-devonz-elements-background-depth-3 px-2 py-1.5 rounded border border-devonz-elements-borderColor">
              <span className="text-blue-400">{selectedElement.tagName.toLowerCase()}</span>
              {selectedElement.id && <span className="text-green-400">#{selectedElement.id}</span>}
              {selectedElement.className && (
                <span className="text-yellow-400">.{selectedElement.className.split(' ')[0]}</span>
              )}
            </div>
          </div>
        </div>

        {/* Bulk Style Selector */}
        <div className="p-3 border-b border-devonz-elements-borderColor bg-devonz-elements-background-depth-2">
          <BulkStyleSelector
            currentTagName={selectedElement.tagName}
            selectedTarget={bulkTarget}
            onSelectTarget={setBulkTarget}
            affectedCount={bulkAffectedCount}
          />
        </div>

        {/* Tabs */}
        <div
          className="flex border-b border-devonz-elements-borderColor"
          style={{ background: 'var(--devonz-elements-bg-depth-3)' }}
        >
          {(['styles', 'text', 'box', 'ai', 'tree', 'colors'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="flex-1 px-1.5 py-2 text-[10px] font-medium capitalize transition-colors"
              style={{
                background: activeTab === tab ? 'var(--devonz-elements-bg-depth-2)' : 'transparent',
                color: activeTab === tab ? 'var(--color-accent-500, #3b82f6)' : 'var(--devonz-elements-textSecondary)',
                borderBottom:
                  activeTab === tab ? '2px solid var(--color-accent-500, #3b82f6)' : '2px solid transparent',
              }}
            >
              {tab === 'ai' ? 'AI' : tab === 'tree' ? '🌳' : tab === 'colors' ? '🎨' : tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-3 overflow-y-auto max-h-80 bg-devonz-elements-background-depth-2">
          {activeTab === 'styles' && (
            <div className="space-y-2">
              {/* Copy All Styles Button */}
              <button
                onClick={handleCopyAllStyles}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded border border-devonz-elements-borderColor bg-devonz-elements-background-depth-3 text-devonz-elements-textSecondary hover:bg-devonz-elements-background-depth-4 hover:text-devonz-elements-textPrimary transition-colors mb-3"
              >
                <span className="i-ph:clipboard w-3.5 h-3.5" />
                {copyFeedback || 'Copy All Styles'}
              </button>

              {Object.entries(getRelevantStyles(selectedElement.styles)).map(([prop, value]) => {
                const editedValue = editedStyles[prop] ?? value;
                const color = isColorProperty(prop) ? parseColorFromValue(editedValue) : null;

                return (
                  <div key={prop} className="flex items-center gap-2 text-xs">
                    <span className="text-devonz-elements-textSecondary min-w-[100px] truncate" title={prop}>
                      {prop}:
                    </span>
                    <div className="flex-1 flex items-center gap-1">
                      {color && (
                        <div className="relative w-6 h-6 rounded overflow-hidden border border-devonz-elements-borderColor">
                          <input
                            type="color"
                            value={color.startsWith('#') ? color : '#000000'}
                            onChange={(e) => handleStyleChange(prop, e.target.value)}
                            className="absolute inset-0 w-[200%] h-[200%] -top-1 -left-1 cursor-pointer border-0 p-0 m-0"
                            style={{ background: 'transparent' }}
                            title="Pick color"
                          />
                        </div>
                      )}
                      <input
                        type="text"
                        spellCheck={false}
                        value={editedValue}
                        onChange={(e) => handleStyleChange(prop, e.target.value)}
                        className="flex-1 bg-devonz-elements-background-depth-3 border border-devonz-elements-borderColor rounded px-2 py-1 text-devonz-elements-textPrimary font-mono text-xs focus:outline-none focus:border-accent-400"
                      />
                    </div>
                  </div>
                );
              })}
              {Object.keys(getRelevantStyles(selectedElement.styles)).length === 0 && (
                <p className="text-devonz-elements-textSecondary text-xs italic">No editable styles found</p>
              )}
            </div>
          )}

          {activeTab === 'text' && (
            <div className="space-y-3">
              <div>
                <label htmlFor="inspector-text-content" className="text-xs text-devonz-elements-textSecondary block mb-1">
                  Text Content
                </label>
                <textarea
                  id="inspector-text-content"
                  value={editedText || selectedElement.textContent}
                  onChange={(e) => handleTextChange(e.target.value)}
                  className="w-full bg-devonz-elements-background-depth-3 border border-devonz-elements-borderColor rounded px-2 py-2 text-devonz-elements-textPrimary text-sm focus:outline-none focus:border-accent-400 resize-none"
                  rows={4}
                  placeholder="Enter text content..."
                />
              </div>
              <p className="text-devonz-elements-textTertiary text-xs">
                Changes apply instantly to the preview. Note: Only works for simple text elements.
              </p>
            </div>
          )}

          {activeTab === 'box' && (
            <BoxModelEditor boxModel={selectedElement.boxModel || null} onValueChange={handleStyleChange} />
          )}

          {activeTab === 'ai' && (
            <AiQuickActions
              selectedElement={selectedElement}
              onAIAction={(message) => {
                onAIAction?.(message);
              }}
            />
          )}

          {activeTab === 'tree' && (
            <ElementTreeNavigator hierarchy={selectedElement.hierarchy || null} onSelectElement={onSelectFromTree} />
          )}

          {activeTab === 'colors' && (
            <PageColorPalette
              colors={selectedElement.colors || []}
              onColorSelect={(color) => {
                // Apply to background-color by default
                handleStyleChange('background-color', color);
              }}
            />
          )}
        </div>

        {/* Footer with action buttons */}
        <div className="p-3 border-t border-devonz-elements-borderColor bg-devonz-elements-background-depth-3 space-y-2">
          {/* Bulk CSS Apply Section - Show when there are accumulated bulk changes */}
          {accumulatedBulkChanges && accumulatedBulkChanges.length > 0 && (
            <div className="space-y-2 p-2 rounded-lg border border-green-500/30 bg-green-500/5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-green-400 font-medium">
                  {accumulatedBulkChanges.length} bulk {accumulatedBulkChanges.length === 1 ? 'change' : 'changes'}{' '}
                  pending
                </span>
                <button
                  onClick={onClearBulkChanges}
                  className="text-devonz-elements-textTertiary hover:text-red-400 transition-colors"
                  title="Clear all bulk changes"
                >
                  <div className="i-ph:x-circle w-4 h-4" />
                </button>
              </div>
              <button
                onClick={onApplyBulkCSS}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
              >
                <div className="i-ph:code w-3.5 h-3.5" />
                Apply All Bulk CSS
              </button>
            </div>
          )}

          {hasChanges ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={handleCopyCSS}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-devonz-elements-borderColor bg-devonz-elements-background-depth-2 text-devonz-elements-textPrimary hover:bg-devonz-elements-background-depth-4 transition-colors"
                >
                  <div className="i-ph:clipboard w-3.5 h-3.5" />
                  {copyFeedback || 'Copy CSS'}
                </button>
                <button
                  onClick={handleApplyWithAI}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors"
                >
                  <div className="i-ph:magic-wand w-3.5 h-3.5" />
                  Apply with AI
                </button>
              </div>
              {/* Revert Button */}
              <button
                onClick={() => {
                  if (bulkTarget && onBulkRevert) {
                    onBulkRevert(bulkTarget.selector);
                  } else {
                    onRevert?.();
                  }

                  setEditedStyles({});
                  setEditedText('');
                }}
                className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  bulkTarget
                    ? 'border-purple-500/30 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 hover:border-purple-500/50'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/50'
                }`}
              >
                <div className="i-ph:arrow-counter-clockwise w-3.5 h-3.5" />
                {bulkTarget ? `Revert All ${bulkTarget.label}` : 'Revert Changes'}
              </button>
            </div>
          ) : (
            <p className="text-devonz-elements-textTertiary text-xs text-center">Edit values above to see live changes</p>
          )}

          {/* Delete Element Button */}
          <button
            onClick={() => onDeleteElement?.(selectedElement)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:border-red-500/50 transition-colors"
          >
            <div className="i-ph:trash w-3.5 h-3.5" />
            Delete Element
          </button>
        </div>
      </div>
    );
  },
);

InspectorPanel.displayName = 'InspectorPanel';
