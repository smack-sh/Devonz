/**
 * Sub-hook: keyboard shortcuts for the Element Inspector.
 *
 * Installs a global `keydown` listener that handles inspector-specific
 * shortcuts such as toggle (Ctrl+Shift+C), undo/redo, and Escape.
 *
 * @module hooks/useInspectorKeyboard
 */

import { useEffect } from 'react';

import { inspectorModeAtom, inspectorPanelVisibleAtom } from '~/lib/stores/inspector';

// ─── Parameter Interface ───────────────────────────────────────────────────

/** Dependencies required by the keyboard shortcut handler. */
export interface UseInspectorKeyboardParams {
  /** Toggle the inspector on/off. */
  toggle: () => void;

  /** Close the inspector detail panel. */
  closePanel: () => void;

  /** Undo the last edit. */
  undo: () => void;

  /** Redo the next edit. */
  redo: () => void;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

/**
 * Registers global keyboard shortcuts for the Element Inspector.
 *
 * - **Ctrl/Cmd + Shift + C** — toggle inspector mode
 * - **Escape** — close panel or deactivate inspector
 * - **Ctrl/Cmd + Z** — undo (when panel is visible)
 * - **Ctrl/Cmd + Shift + Z** — redo (when panel is visible)
 *
 * @param params - Action callbacks the shortcuts delegate to.
 */
export function useInspectorKeyboard(params: UseInspectorKeyboardParams): void {
  const { toggle, closePanel, undo, redo } = params;

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
}
