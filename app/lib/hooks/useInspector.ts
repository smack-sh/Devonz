/**
 * Central orchestrator hook for the Element Inspector system.
 *
 * Composes the sub-hooks ({@link useInspectorMessages},
 * {@link useInspectorKeyboard}, {@link useInspectorAI}) and the
 * nanostore atoms into a single, self-contained React hook.
 * Components consume this hook instead of managing scattered `useState`
 * calls or raw `postMessage` interactions.
 *
 * @module hooks/useInspector
 */

import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '@nanostores/react';

import type { BulkStyleChange, BulkTarget, ElementInfo, InspectorMode, InspectorTab } from '~/lib/inspector/types';
import type { ThemeData } from '~/lib/inspector/types';
import { RELEVANT_STYLE_PROPS } from '~/lib/inspector/types';

import {
  activateInspector,
  editStyle as sendEditStyle,
  editText as sendEditText,
  editAttribute as sendEditAttribute,
  editCSSVar as sendEditCSSVar,
  scanTheme as sendScanTheme,
  selectBySelector,
  revertChanges,
  bulkEditStyle,
  bulkRevert as sendBulkRevert,
  countElements,
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
  themeDataAtom,
  toggleInspectorMode,
  updatePendingStyle,
  clearPendingEdits,
  undoEdit,
  redoEdit,
  addBulkChange,
  removeBulkChangesForSelector,
  clearAllBulkChanges,
} from '~/lib/stores/inspector';

import { useInspectorMessages } from './useInspectorMessages';
import { useInspectorKeyboard } from './useInspectorKeyboard';
import { useInspectorAI } from './useInspectorAI';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';

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
  themeData: ThemeData | null;

  // ── Actions ────────────────────────────────────────────────────────
  toggle: () => void;
  closePanel: () => void;
  setActiveTab: (tab: InspectorTab) => void;
  editStyle: (property: string, value: string) => void;
  editText: (text: string) => void;
  editAttribute: (attribute: string, value: string) => void;
  editCSSVar: (name: string, value: string) => void;
  scanTheme: () => void;
  navigateToSource: (filePath: string, line?: number) => void;
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
 * Subscribes to every relevant nanostore atom, delegates iframe message
 * handling to {@link useInspectorMessages}, keyboard shortcuts to
 * {@link useInspectorKeyboard}, and AI prompt construction to
 * {@link useInspectorAI}. All inspector-related state and actions are
 * returned as a single cohesive API surface.
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
  const themeData = useStore(themeDataAtom);

  const canUndoValue = editIndex >= 0;
  const canRedoValue = editIndex < editHistory.length - 1;

  // Keep a stable ref to the latest selection callback.
  const onSelectedElementChangeRef = useRef(onSelectedElementChange);
  onSelectedElementChangeRef.current = onSelectedElementChange;

  // ── Notify external consumer of selection changes ──────────────────

  useEffect(() => {
    onSelectedElementChangeRef.current?.(selectedElement);
  }, [selectedElement]);

  // ── Sub-hooks ──────────────────────────────────────────────────────

  const { getIframe } = useInspectorMessages(iframeRef);
  const { applyWithAI, applyBulkCSS } = useInspectorAI(onAIAction);

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

  /** Set an HTML attribute on the currently selected element. */
  const editAttribute = useCallback(
    (attribute: string, value: string) => {
      const iframe = getIframe();

      if (iframe) {
        sendEditAttribute(iframe, attribute, value);
      }
    },
    [getIframe],
  );

  /** Edit a CSS custom property (variable) on :root. */
  const editCSSVar = useCallback(
    (name: string, value: string) => {
      const iframe = getIframe();

      if (iframe) {
        sendEditCSSVar(iframe, name, value);
      }
    },
    [getIframe],
  );

  /** Request a full theme scan of the preview page. */
  const scanTheme = useCallback(() => {
    const iframe = getIframe();

    if (iframe) {
      sendScanTheme(iframe);
    }
  }, [getIframe]);

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
    } else if (entry.kind === 'attribute') {
      sendEditAttribute(iframe, entry.edit.attribute, entry.edit.oldValue);
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
    } else if (entry.kind === 'attribute') {
      sendEditAttribute(iframe, entry.edit.attribute, entry.edit.newValue);
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

  /** Set the bulk-edit target selector/label and request an element count. */
  const setBulkTargetAction = useCallback(
    (target: BulkTarget | null) => {
      bulkTargetAtom.set(target);

      if (target?.selector) {
        const iframe = getIframe();

        if (iframe) {
          countElements(iframe, target.selector);
        }
      } else {
        bulkAffectedCountAtom.set(undefined);
      }
    },
    [getIframe],
  );

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

  /** Navigate to a source file in the code editor. */
  const navigateToSource = useCallback((filePath: string, line?: number) => {
    // Normalise the file path: strip leading slash if needed
    const normalised = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    const fullPath = `${WORK_DIR}/${normalised}`;

    // Switch to the code view and select the file
    workbenchStore.currentView.set('code');
    workbenchStore.setSelectedFile(fullPath);

    // If a line number is provided, scroll to it
    if (line != null) {
      workbenchStore.setCurrentDocumentScrollPosition({
        line: Math.max(0, line - 1),
        column: 0,
      });
    }
  }, []);

  // ── Keyboard shortcuts (delegated to sub-hook) ─────────────────────

  useInspectorKeyboard({ toggle, closePanel, undo, redo });

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
    themeData,

    // Actions
    toggle,
    closePanel,
    setActiveTab,
    editStyle,
    editText,
    editAttribute,
    editCSSVar,
    scanTheme,
    navigateToSource,
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
