/**
 * Sub-hook: AI prompt construction and dispatch for the Element Inspector.
 *
 * Builds human-readable prompts from pending style/text edits (single
 * or bulk) and forwards them to the consumer's `onAIAction` callback.
 *
 * @module hooks/useInspectorAI
 */

import { useCallback } from 'react';

import {
  selectedElementAtom,
  pendingEditsAtom,
  pendingTextEditAtom,
  inspectorPanelVisibleAtom,
  accumulatedBulkChangesAtom,
  clearAllBulkChanges,
} from '~/lib/stores/inspector';

import { sanitizeCSSValue } from '~/utils/sanitize';
import { buildElementSelector } from '~/utils/selector';

// ─── Return Interface ──────────────────────────────────────────────────────

/** Actions exposed by the AI sub-hook. */
export interface UseInspectorAIReturn {
  /** Build a prompt from pending single-element edits and dispatch it. */
  applyWithAI: () => void;

  /**
   * Build a CSS stylesheet from accumulated bulk changes, dispatch it,
   * and clear the bulk state.
   */
  applyBulkCSS: () => void;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

/**
 * Provides AI-related actions for the Element Inspector.
 *
 * Both actions read directly from nanostore atoms, construct a
 * descriptive prompt, and pass it to the `onAIAction` callback.
 *
 * @param onAIAction - Callback that receives the generated AI prompt.
 * @returns `applyWithAI` and `applyBulkCSS` action functions.
 */
export function useInspectorAI(onAIAction: ((message: string) => void) | undefined): UseInspectorAIReturn {
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

    // Build a human-readable selector (sanitised)
    const selector = buildElementSelector(element);

    const changeLines: string[] = [];
    const styleEntries = Object.entries(edits);

    if (styleEntries.length > 0) {
      changeLines.push('**Style changes:**');
      styleEntries.forEach(([prop, value]) => {
        changeLines.push(`- ${prop}: ${sanitizeCSSValue(value as string)}`);
      });
    }

    if (textEdit) {
      changeLines.push(`**Text content:** "${textEdit}"`);
    }

    const message = `Please apply these changes to the element \`${selector}\`:\n\n${changeLines.join('\n')}\n\nFind this element in the source code and update its styles/text accordingly.`;

    onAIAction?.(message);

    // Close panel after dispatching
    inspectorPanelVisibleAtom.set(false);
    selectedElementAtom.set(null);
  }, [onAIAction]);

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

    onAIAction?.(message);

    // Clear accumulated bulk state after dispatch
    clearAllBulkChanges();
    inspectorPanelVisibleAtom.set(false);
    selectedElementAtom.set(null);
  }, [onAIAction]);

  return { applyWithAI, applyBulkCSS };
}
