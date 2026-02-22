/**
 * Central orchestrator hook for the Element Inspector system.
 *
 * Bridges the nanostore atoms (state), the message bridge (iframe comms),
 * and the keyboard shortcuts into a single, self-contained React hook.
 * Components consume this hook instead of managing scattered `useState`
 * calls or raw `postMessage` interactions.
 *
 * @module hooks/useInspector
 */

import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '@nanostores/react';

import type { BulkStyleChange, BulkTarget, ElementInfo, InspectorMode, InspectorTab } from '~/lib/inspector/types';
import { RELEVANT_STYLE_PROPS } from '~/lib/inspector/types';

import {
  createMessageHandler,
  activateInspector,
  editStyle as sendEditStyle,
  editText as sendEditText,
  selectBySelector,
  revertChanges,
  bulkEditStyle,
  bulkRevert as sendBulkRevert,
  deleteElement,
} from '~/lib/inspector/message-bridge';

import {
  inspectorModeAtom,
  selectedElementAtom,
  hoveredElementAtom,
  inspectorPanelVisibleAtom,
  activeInspectorTabAtom,
  pendingEditsAtom,
  pendingTextEditAtom,
  bulkTargetAtom,
  accumulatedBulkChangesAtom,
  bulkAffectedCountAtom,
  editHistoryAtom,
  editIndexAtom,
  toggleInspectorMode,
  selectElement,
  updatePendingStyle,
  clearPendingEdits,
  pushEdit,
  undoEdit,
  redoEdit,
  addBulkChange,
  removeBulkChangesForSelector,
  clearAllBulkChanges,
} from '~/lib/stores/inspector';

import { getPreviewErrorHandler } from '~/utils/previewErrorHandler';

// ─── Screenshot Callback Registry ──────────────────────────────────────────

/**
 * Module-level map correlating screenshot request IDs to their resolution
 * callbacks. Shared across all hook instances (there should only be one).
 */
const screenshotCallbacks = new Map<string, (dataUrl: string, isPlaceholder: boolean) => void>();

// ─── Public Interfaces ──────────────────────────────────────────────────────

/** Configuration accepted by {@link useInspector}. */
export interface UseInspectorOptions {
  /** Ref to the preview `<iframe>` used for postMessage communication. */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;

  /** Called when an AI action should be dispatched to the chat. */
  onAIAction?: (message: string) => void;

  /** Called when the selected element changes (external consumer sync). */
  onSelectedElementChange?: (element: ElementInfo | null) => void;
}

/** Shape returned by {@link useInspector}. */
export interface UseInspectorReturn {
  // ── Reactive state (read-only projections from the store) ──────────
  mode: InspectorMode;
  selectedElement: ElementInfo | null;
  hoveredElement: ElementInfo | null;
  isPanelVisible: boolean;
  activeTab: InspectorTab;
  pendingEdits: Record<string, string>;
  pendingTextEdit: string;
  bulkTarget: BulkTarget | null;
  accumulatedBulkChanges: BulkStyleChange[];
  bulkAffectedCount: number | undefined;
  canUndo: boolean;
  canRedo: boolean;

  // ── Actions ────────────────────────────────────────────────────────
  toggle: () => void;
  closePanel: () => void;
  setActiveTab: (tab: InspectorTab) => void;
  editStyle: (property: string, value: string) => void;
  editText: (text: string) => void;
  undo: () => void;
  redo: () => void;
  revert: () => void;
  selectFromTree: (selector: string) => void;
  deleteSelectedElement: () => void;
  copyCSS: () => Promise<boolean>;
  copyAllStyles: () => Promise<boolean>;
  applyWithAI: () => void;
  setBulkTarget: (target: BulkTarget | null) => void;
  bulkStyleChange: (selector: string, property: string, value: string) => void;
  revertBulk: (selector: string) => void;
  applyBulkCSS: () => void;
  clearBulkChanges: () => void;
  generateCSS: () => string;
}

// ─── Hook Implementation ────────────────────────────────────────────────────

/**
 * Central orchestrator hook for the Element Inspector.
 *
 * Subscribes to every relevant nanostore atom, forwards commands to the
 * preview iframe via the typed message bridge, and installs keyboard
 * shortcuts. All inspector-related state and actions are returned as a
 * single cohesive API surface.
 *
 * @param options - Iframe ref and optional callbacks.
 * @returns Reactive state and action functions.
 */
export function useInspector(options: UseInspectorOptions): UseInspectorReturn {
  const { iframeRef, onAIAction, onSelectedElementChange } = options;

  // ── Store subscriptions ────────────────────────────────────────────

  const mode = useStore(inspectorModeAtom);
  const selectedElement = useStore(selectedElementAtom);
  const hoveredElement = useStore(hoveredElementAtom);
  const isPanelVisible = useStore(inspectorPanelVisibleAtom);
  const activeTab = useStore(activeInspectorTabAtom);
  const pendingEdits = useStore(pendingEditsAtom);
  const pendingTextEdit = useStore(pendingTextEditAtom);
  const bulkTarget = useStore(bulkTargetAtom);
  const accumulatedBulkChanges = useStore(accumulatedBulkChangesAtom);
  const bulkAffectedCount = useStore(bulkAffectedCountAtom);
  const editHistory = useStore(editHistoryAtom);
  const editIndex = useStore(editIndexAtom);

  const canUndoValue = editIndex >= 0;
  const canRedoValue = editIndex < editHistory.length - 1;

  // Keep a stable ref to the latest callbacks so effects don't re-run.
  const callbacksRef = useRef({ onAIAction, onSelectedElementChange });
  callbacksRef.current = { onAIAction, onSelectedElementChange };

  // ── Notify external consumer of selection changes ──────────────────

  useEffect(() => {
    callbacksRef.current.onSelectedElementChange?.(selectedElement);
  }, [selectedElement]);

  // ── Iframe helper (safe access) ────────────────────────────────────

  const getIframe = useCallback((): HTMLIFrameElement | null => {
    return iframeRef.current;
  }, [iframeRef]);

  // ── Message listener (iframe → parent) ─────────────────────────────

  useEffect(() => {
    const handler = createMessageHandler({
      onReady() {
        const iframe = getIframe();

        if (iframe) {
          activateInspector(iframe, inspectorModeAtom.get() !== 'off');
        }
      },

      onHover(event) {
        hoveredElementAtom.set(event.elementInfo);
      },

      onLeave() {
        hoveredElementAtom.set(null);
      },

      onClick(event) {
        const element = event.elementInfo;

        // Copy the display text to clipboard (best-effort)
        navigator.clipboard.writeText(element.displayText).catch(() => {
          /* Clipboard write failed — non-critical */
        });

        selectElement(element);
      },

      onResize(_event) {
        /*
         * Resize tracking — intentionally a no-op for now.
         * Could be used for live dimension readouts in the future.
         */
      },

      onResizeEnd(event) {
        selectedElementAtom.set(event.elementInfo);
      },

      onEditApplied(event) {
        if (event.success) {
          const current = selectedElementAtom.get();

          if (current) {
            pushEdit({
              kind: 'style',
              edit: {
                property: event.property,
                oldValue: current.styles[event.property] ?? '',
                newValue: event.value,
                timestamp: Date.now(),
              },
              elementSelector: current.selector,
            });
          }
        }
      },

      onTextApplied(event) {
        if (event.success) {
          const current = selectedElementAtom.get();

          if (current) {
            pushEdit({
              kind: 'text',
              edit: {
                oldText: current.textContent,
                newText: event.text,
                timestamp: Date.now(),
              },
              elementSelector: current.selector,
            });
          }
        }
      },

      onReverted(event) {
        if (event.success) {
          if (event.elementInfo) {
            selectedElementAtom.set(event.elementInfo);
          }

          clearPendingEdits();
        }
      },

      onBulkApplied(event) {
        bulkAffectedCountAtom.set(event.count);
      },

      onBulkReverted(event) {
        if (event.success) {
          bulkAffectedCountAtom.set(event.count > 0 ? event.count : undefined);
          removeBulkChangesForSelector(event.selector);
        }
      },

      onElementCount(event) {
        bulkAffectedCountAtom.set(event.count);
      },

      onElementDeleted(event) {
        if (event.success) {
          selectElement(null);
        }
      },

      onConsoleError(event) {
        let parsedUrl: URL;

        try {
          parsedUrl = new URL(event.url || globalThis.location.href);
        } catch {
          parsedUrl = new URL(globalThis.location.href);
        }

        getPreviewErrorHandler().handlePreviewMessage({
          type: 'PREVIEW_UNCAUGHT_EXCEPTION',
          message: event.message,
          stack: event.stack,
          pathname: parsedUrl.pathname,
          search: parsedUrl.search,
          hash: parsedUrl.hash,
          port: 0,
        });
      },

      onViteError(event) {
        let parsedUrl: URL;

        try {
          parsedUrl = new URL(event.url || globalThis.location.href);
        } catch {
          parsedUrl = new URL(globalThis.location.href);
        }

        getPreviewErrorHandler().handlePreviewMessage({
          type: 'PREVIEW_UNCAUGHT_EXCEPTION',
          message: event.fullMessage || event.message,
          stack: event.stack || '',
          pathname: parsedUrl.pathname,
          search: parsedUrl.search,
          hash: parsedUrl.hash,
          port: 0,
        });
      },

      onScreenshotResponse(event) {
        const callback = screenshotCallbacks.get(event.requestId);

        if (callback) {
          callback(event.dataUrl, event.isPlaceholder);
          screenshotCallbacks.delete(event.requestId);
        }
      },
    });

    globalThis.addEventListener('message', handler);

    return () => {
      globalThis.removeEventListener('message', handler);
    };
  }, [getIframe]);

  // ── Actions ────────────────────────────────────────────────────────

  /** Toggle the inspector between `'off'` and `'inspect'` modes. */
  const toggle = useCallback(() => {
    const wasActive = inspectorModeAtom.get() !== 'off';

    toggleInspectorMode();

    const iframe = getIframe();

    if (iframe) {
      activateInspector(iframe, !wasActive);
    }
  }, [getIframe]);

  /** Close the inspector detail panel (without deactivating inspect mode). */
  const closePanel = useCallback(() => {
    inspectorPanelVisibleAtom.set(false);
    selectedElementAtom.set(null);
  }, []);

  /** Switch the active detail-panel tab. */
  const setActiveTab = useCallback((tab: InspectorTab) => {
    activeInspectorTabAtom.set(tab);
  }, []);

  /** Apply a CSS property change to the currently selected element. */
  const editStyle = useCallback(
    (property: string, value: string) => {
      updatePendingStyle(property, value);

      const iframe = getIframe();

      if (iframe) {
        sendEditStyle(iframe, property, value);
      }
    },
    [getIframe],
  );

  /** Replace the text content of the currently selected element. */
  const editText = useCallback(
    (text: string) => {
      pendingTextEditAtom.set(text);

      const iframe = getIframe();

      if (iframe) {
        sendEditText(iframe, text);
      }
    },
    [getIframe],
  );

  /** Undo the last edit, reverting the change inside the iframe. */
  const undo = useCallback(() => {
    const entry = undoEdit();

    if (!entry) {
      return;
    }

    const iframe = getIframe();

    if (!iframe) {
      return;
    }

    if (entry.kind === 'style') {
      sendEditStyle(iframe, entry.edit.property, entry.edit.oldValue);
    } else if (entry.kind === 'text') {
      sendEditText(iframe, entry.edit.oldText);
    } else {
      revertChanges(iframe);
    }
  }, [getIframe]);

  /** Redo the next edit, re-applying the change inside the iframe. */
  const redo = useCallback(() => {
    const entry = redoEdit();

    if (!entry) {
      return;
    }

    const iframe = getIframe();

    if (!iframe) {
      return;
    }

    if (entry.kind === 'style') {
      sendEditStyle(iframe, entry.edit.property, entry.edit.newValue);
    } else if (entry.kind === 'text') {
      sendEditText(iframe, entry.edit.newText);
    }
  }, [getIframe]);

  /** Revert all pending changes on the currently selected element. */
  const revert = useCallback(() => {
    const iframe = getIframe();

    if (iframe) {
      revertChanges(iframe);
    }

    clearPendingEdits();
  }, [getIframe]);

  /** Select an element from the DOM tree by CSS selector. */
  const selectFromTree = useCallback(
    (selector: string) => {
      const iframe = getIframe();

      if (iframe) {
        selectBySelector(iframe, selector);
      }
    },
    [getIframe],
  );

  /** Delete the currently selected element from the DOM. */
  const deleteSelectedElement = useCallback(() => {
    const iframe = getIframe();

    if (iframe) {
      deleteElement(iframe);
    }
  }, [getIframe]);

  /**
   * Generate a CSS rule string from the current pending edits.
   *
   * @returns A CSS rule block (or empty string when there are no edits).
   */
  const generateCSS = useCallback((): string => {
    const edits = pendingEditsAtom.get();
    const element = selectedElementAtom.get();

    const entries = Object.entries(edits);

    if (entries.length === 0 || !element) {
      return '';
    }

    const styleLines = entries.map(([prop, value]) => `  ${prop}: ${value};`).join('\n');

    return `${element.selector} {\n${styleLines}\n}`;
  }, []);

  /**
   * Copy the generated CSS (from pending edits) to the clipboard.
   *
   * @returns `true` if the copy succeeded, `false` otherwise.
   */
  const copyCSS = useCallback(async (): Promise<boolean> => {
    const css = generateCSS();

    if (!css) {
      return false;
    }

    try {
      await navigator.clipboard.writeText(css);

      return true;
    } catch {
      return false;
    }
  }, [generateCSS]);

  /**
   * Copy all relevant computed styles for the selected element as a CSS
   * rule to the clipboard.
   *
   * @returns `true` if the copy succeeded, `false` otherwise.
   */
  const copyAllStyles = useCallback(async (): Promise<boolean> => {
    const element = selectedElementAtom.get();

    if (!element) {
      return false;
    }

    const lines: string[] = [];

    for (const prop of RELEVANT_STYLE_PROPS) {
      const value = element.styles[prop];

      if (value) {
        lines.push(`  ${prop}: ${value};`);
      }
    }

    if (lines.length === 0) {
      return false;
    }

    const css = `${element.selector} {\n${lines.join('\n')}\n}`;

    try {
      await navigator.clipboard.writeText(css);

      return true;
    } catch {
      return false;
    }
  }, []);

  /**
   * Build an AI prompt describing the pending changes and forward it to
   * the consumer via the `onAIAction` callback.
   */
  const applyWithAI = useCallback(() => {
    const element = selectedElementAtom.get();
    const edits = pendingEditsAtom.get();
    const textEdit = pendingTextEditAtom.get();

    if (!element) {
      return;
    }

    // Build a human-readable selector
    const selectorParts = [element.tagName.toLowerCase()];

    if (element.id) {
      selectorParts.push(`#${element.id}`);
    }

    if (element.className) {
      const firstClass = element.className.split(' ')[0];

      if (firstClass) {
        selectorParts.push(`.${firstClass}`);
      }
    }

    const selector = selectorParts.join('');

    const changeLines: string[] = [];
    const styleEntries = Object.entries(edits);

    if (styleEntries.length > 0) {
      changeLines.push('**Style changes:**');
      styleEntries.forEach(([prop, value]) => {
        changeLines.push(`- ${prop}: ${value}`);
      });
    }

    if (textEdit) {
      changeLines.push(`**Text content:** "${textEdit}"`);
    }

    const message = `Please apply these changes to the element \`${selector}\`:\n\n${changeLines.join('\n')}\n\nFind this element in the source code and update its styles/text accordingly.`;

    callbacksRef.current.onAIAction?.(message);

    // Close panel after dispatching
    inspectorPanelVisibleAtom.set(false);
    selectedElementAtom.set(null);
  }, []);

  /** Set the bulk-edit target selector/label. */
  const setBulkTargetAction = useCallback((target: BulkTarget | null) => {
    bulkTargetAtom.set(target);
  }, []);

  /** Apply a single bulk style change and forward to the iframe. */
  const bulkStyleChangeAction = useCallback(
    (selector: string, property: string, value: string) => {
      addBulkChange({ selector, property, value });

      const iframe = getIframe();

      if (iframe) {
        bulkEditStyle(iframe, selector, property, value);
      }
    },
    [getIframe],
  );

  /** Revert all bulk changes for a given selector inside the iframe. */
  const revertBulkAction = useCallback(
    (selector: string) => {
      removeBulkChangesForSelector(selector);

      const iframe = getIframe();

      if (iframe) {
        sendBulkRevert(iframe, selector);
      }
    },
    [getIframe],
  );

  /**
   * Generate a full CSS stylesheet from accumulated bulk changes and
   * forward it to the AI via `onAIAction`.
   */
  const applyBulkCSS = useCallback(() => {
    const changes = accumulatedBulkChangesAtom.get();

    if (changes.length === 0) {
      return;
    }

    // Group changes by selector for cleaner CSS output
    const grouped: Record<string, Record<string, string>> = {};

    for (const { selector, property, value } of changes) {
      grouped[selector] ??= {};
      grouped[selector][property] = value;
    }

    const cssRules = Object.entries(grouped)
      .map(([sel, styles]) => {
        const styleLines = Object.entries(styles)
          .map(([prop, val]) => `  ${prop}: ${val} !important;`)
          .join('\n');

        return `${sel} {\n${styleLines}\n}`;
      })
      .join('\n\n');

    const fullCSS = `/* Bulk Style Changes — Applied via Inspector */\n${cssRules}`;

    const message = `Please add the following CSS rules to the project's main stylesheet (or create a new style block if needed):\n\n\`\`\`css\n${fullCSS}\n\`\`\`\n\nAdd these rules to style the elements as specified. The !important flags ensure these styles take precedence.`;

    callbacksRef.current.onAIAction?.(message);

    // Clear accumulated bulk state after dispatch
    clearAllBulkChanges();
    inspectorPanelVisibleAtom.set(false);
    selectedElementAtom.set(null);
  }, []);

  /** Clear all accumulated bulk changes and revert them in the iframe. */
  const clearBulkChangesAction = useCallback(() => {
    const changes = accumulatedBulkChangesAtom.get();
    const iframe = getIframe();

    if (iframe) {
      const uniqueSelectors = [...new Set(changes.map((c: BulkStyleChange) => c.selector))] as string[];

      for (const selector of uniqueSelectors) {
        sendBulkRevert(iframe, selector);
      }
    }

    clearAllBulkChanges();
  }, [getIframe]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;

      // Ctrl/Cmd + Shift + C → toggle inspector
      if (modifier && event.shiftKey && event.key === 'C') {
        event.preventDefault();
        toggle();

        return;
      }

      // Escape → close panel or deactivate
      if (event.key === 'Escape') {
        if (inspectorPanelVisibleAtom.get()) {
          event.preventDefault();
          closePanel();
        } else if (inspectorModeAtom.get() !== 'off') {
          event.preventDefault();
          toggle();
        }

        return;
      }

      // Only handle undo/redo when the inspector panel is visible
      if (!inspectorPanelVisibleAtom.get()) {
        return;
      }

      // Ctrl/Cmd + Shift + Z → redo
      if (modifier && event.shiftKey && event.key === 'Z') {
        event.preventDefault();
        redo();

        return;
      }

      // Ctrl/Cmd + Z → undo
      if (modifier && event.key === 'z') {
        event.preventDefault();
        undo();
      }
    };

    globalThis.addEventListener('keydown', handleKeyDown);

    return () => {
      globalThis.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggle, closePanel, undo, redo]);

  // ── Return ─────────────────────────────────────────────────────────

  return {
    // State
    mode,
    selectedElement,
    hoveredElement,
    isPanelVisible,
    activeTab,
    pendingEdits,
    pendingTextEdit,
    bulkTarget,
    accumulatedBulkChanges,
    bulkAffectedCount,
    canUndo: canUndoValue,
    canRedo: canRedoValue,

    // Actions
    toggle,
    closePanel,
    setActiveTab,
    editStyle,
    editText,
    undo,
    redo,
    revert,
    selectFromTree,
    deleteSelectedElement,
    copyCSS,
    copyAllStyles,
    applyWithAI,
    setBulkTarget: setBulkTargetAction,
    bulkStyleChange: bulkStyleChangeAction,
    revertBulk: revertBulkAction,
    applyBulkCSS,
    clearBulkChanges: clearBulkChangesAction,
    generateCSS,
  };
}
