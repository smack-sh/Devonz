/**
 * Sub-hook: iframe ↔ parent message handling for the Element Inspector.
 *
 * Installs the `message` event listener that dispatches incoming inspector
 * events to the appropriate callbacks, and exposes the module-level
 * screenshot callback registry.
 *
 * @module hooks/useInspectorMessages
 */

import { useCallback, useEffect } from 'react';

import { createMessageHandler, activateInspector } from '~/lib/inspector/message-bridge';

import {
  inspectorModeAtom,
  selectedElementAtom,
  hoveredElementAtom,
  bulkAffectedCountAtom,
  themeDataAtom,
  selectElement,
  pushEdit,
  clearPendingEdits,
  updatePendingStyle,
  removeBulkChangesForSelector,
} from '~/lib/stores/inspector';

import { getPreviewErrorHandler } from '~/utils/previewErrorHandler';

// ─── Screenshot Callback Registry ──────────────────────────────────────────

/**
 * Module-level map correlating screenshot request IDs to their resolution
 * callbacks. Shared across all hook instances (there should only be one).
 */
export const screenshotCallbacks = new Map<string, (dataUrl: string, isPlaceholder: boolean) => void>();

// ─── Callback Interface ────────────────────────────────────────────────────

/** No additional callbacks beyond what the message-bridge already handles. */

// ─── Hook ──────────────────────────────────────────────────────────────────

/**
 * Sets up the `message` event listener that bridges inspector events
 * from the preview iframe to nanostore atoms and callback refs.
 *
 * @param iframeRef - Ref to the preview `<iframe>`.
 * @returns Object with `getIframe` accessor for other hooks to reuse.
 */
export function useInspectorMessages(iframeRef: React.RefObject<HTMLIFrameElement | null>): {
  getIframe: () => HTMLIFrameElement | null;
} {
  const getIframe = useCallback((): HTMLIFrameElement | null => {
    return iframeRef.current;
  }, [iframeRef]);

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

      onResize(event) {
        // Live dimension preview during drag
        const current = selectedElementAtom.get();

        if (current) {
          selectedElementAtom.set({
            ...current,
            rect: { ...current.rect, width: event.width, height: event.height },
            styles: {
              ...current.styles,
              width: Math.round(event.width) + 'px',
              height: Math.round(event.height) + 'px',
            },
          });
        }
      },

      onResizeEnd(event) {
        selectedElementAtom.set(event.elementInfo);

        // Track the resize as pending edits and push to history
        const oldW = Math.round(event.oldWidth) + 'px';
        const oldH = Math.round(event.oldHeight) + 'px';
        const newW = event.elementInfo.styles.width ?? '';
        const newH = event.elementInfo.styles.height ?? '';

        if (oldW !== newW) {
          updatePendingStyle('width', newW);
          pushEdit({
            kind: 'style',
            edit: {
              property: 'width',
              oldValue: oldW,
              newValue: newW,
              timestamp: Date.now(),
            },
            elementSelector: event.elementInfo.selector,
          });
        }

        if (oldH !== newH) {
          updatePendingStyle('height', newH);
          pushEdit({
            kind: 'style',
            edit: {
              property: 'height',
              oldValue: oldH,
              newValue: newH,
              timestamp: Date.now(),
            },
            elementSelector: event.elementInfo.selector,
          });
        }
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

      onAttributeApplied(event) {
        if (event.success) {
          const current = selectedElementAtom.get();

          if (current) {
            pushEdit({
              kind: 'attribute',
              edit: {
                attribute: event.attribute,
                oldValue: event.oldValue,
                newValue: event.value,
                timestamp: Date.now(),
              },
              elementSelector: current.selector,
            });
          }
        }
      },

      onCSSVarApplied(_event) {
        /*
         * CSS variable edits are global — no per-element undo tracking needed.
         * The ThemeEditor handles its own local state and re-scans after edits.
         */
      },

      onThemeData(event) {
        themeDataAtom.set(event.theme);
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

  return { getIframe };
}
