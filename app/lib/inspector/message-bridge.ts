/**
 * Type-safe message bridge for the Inspector system.
 *
 * Handles all `postMessage` communication between the parent window
 * and the preview iframe. Every function is pure — no state, no
 * subscriptions, no side-effects beyond the message send itself.
 *
 * @module inspector/message-bridge
 */

import type {
  InspectorCommand,
  InspectorEvent,
  ReadyEvent,
  HoverEvent,
  LeaveEvent,
  ClickEvent,
  ResizeEvent,
  ResizeEndEvent,
  EditAppliedEvent,
  TextAppliedEvent,
  RevertedEvent,
  BulkAppliedEvent,
  BulkRevertedEvent,
  ElementCountEvent,
  ElementDeletedEvent,
  AttributeAppliedEvent,
  CSSVarAppliedEvent,
  ThemeDataEvent,
  ConsoleErrorEvent,
  ViteErrorEvent,
  ScreenshotResponseEvent,
  ScreenshotOptions,
} from './protocol';
import { isInspectorEvent } from './protocol';

// ─── Handler Interface ──────────────────────────────────────────────────────

/** Callback map for every inspector event the parent window can receive. */
export interface InspectorEventHandlers {
  onReady: (event: ReadyEvent) => void;
  onHover: (event: HoverEvent) => void;
  onLeave: (event: LeaveEvent) => void;
  onClick: (event: ClickEvent) => void;
  onResize: (event: ResizeEvent) => void;
  onResizeEnd: (event: ResizeEndEvent) => void;
  onEditApplied: (event: EditAppliedEvent) => void;
  onTextApplied: (event: TextAppliedEvent) => void;
  onReverted: (event: RevertedEvent) => void;
  onBulkApplied: (event: BulkAppliedEvent) => void;
  onBulkReverted: (event: BulkRevertedEvent) => void;
  onElementCount: (event: ElementCountEvent) => void;
  onElementDeleted: (event: ElementDeletedEvent) => void;
  onAttributeApplied: (event: AttributeAppliedEvent) => void;
  onCSSVarApplied: (event: CSSVarAppliedEvent) => void;
  onThemeData: (event: ThemeDataEvent) => void;
  onConsoleError: (event: ConsoleErrorEvent) => void;
  onViteError: (event: ViteErrorEvent) => void;
  onScreenshotResponse: (event: ScreenshotResponseEvent) => void;
}

// ─── Core Transport ─────────────────────────────────────────────────────────

/**
 * Send a typed command to the preview iframe via `postMessage`.
 *
 * @param iframe  - Target `<iframe>` element containing the preview.
 * @param command - Discriminated-union command payload.
 * @returns `true` if the message was posted, `false` if `contentWindow` is unavailable.
 */
export function sendCommand(iframe: HTMLIFrameElement, command: InspectorCommand): boolean {
  if (!iframe.contentWindow) {
    return false;
  }

  iframe.contentWindow.postMessage(command, '*');

  return true;
}

/**
 * Create a `MessageEvent` listener that dispatches incoming inspector
 * events to the appropriate handler callback.
 *
 * Non-inspector messages are silently ignored.  Only the handlers
 * provided in the partial map are invoked — missing handlers are skipped.
 *
 * @param handlers - Partial map of event-type → callback.
 * @returns A function suitable for `window.addEventListener('message', …)`.
 */
export function createMessageHandler(handlers: Partial<InspectorEventHandlers>): (event: MessageEvent) => void {
  const dispatchMap: Record<string, (event: InspectorEvent) => void> = {
    INSPECTOR_READY: (e) => handlers.onReady?.(e as ReadyEvent),
    INSPECTOR_HOVER: (e) => handlers.onHover?.(e as HoverEvent),
    INSPECTOR_LEAVE: (e) => handlers.onLeave?.(e as LeaveEvent),
    INSPECTOR_CLICK: (e) => handlers.onClick?.(e as ClickEvent),
    INSPECTOR_RESIZE: (e) => handlers.onResize?.(e as ResizeEvent),
    INSPECTOR_RESIZE_END: (e) => handlers.onResizeEnd?.(e as ResizeEndEvent),
    INSPECTOR_EDIT_APPLIED: (e) => handlers.onEditApplied?.(e as EditAppliedEvent),
    INSPECTOR_TEXT_APPLIED: (e) => handlers.onTextApplied?.(e as TextAppliedEvent),
    INSPECTOR_REVERTED: (e) => handlers.onReverted?.(e as RevertedEvent),
    INSPECTOR_BULK_APPLIED: (e) => handlers.onBulkApplied?.(e as BulkAppliedEvent),
    INSPECTOR_BULK_REVERTED: (e) => handlers.onBulkReverted?.(e as BulkRevertedEvent),
    INSPECTOR_ELEMENT_COUNT: (e) => handlers.onElementCount?.(e as ElementCountEvent),
    INSPECTOR_ELEMENT_DELETED: (e) => handlers.onElementDeleted?.(e as ElementDeletedEvent),
    INSPECTOR_ATTRIBUTE_APPLIED: (e) => handlers.onAttributeApplied?.(e as AttributeAppliedEvent),
    INSPECTOR_CSS_VAR_APPLIED: (e) => handlers.onCSSVarApplied?.(e as CSSVarAppliedEvent),
    INSPECTOR_THEME_DATA: (e) => handlers.onThemeData?.(e as ThemeDataEvent),
    PREVIEW_CONSOLE_ERROR: (e) => handlers.onConsoleError?.(e as ConsoleErrorEvent),
    PREVIEW_VITE_ERROR: (e) => handlers.onViteError?.(e as ViteErrorEvent),
    PREVIEW_SCREENSHOT_RESPONSE: (e) => handlers.onScreenshotResponse?.(e as ScreenshotResponseEvent),
  };

  return (event: MessageEvent): void => {
    const { data } = event;

    if (!isInspectorEvent(data)) {
      return;
    }

    dispatchMap[data.type]?.(data);
  };
}

// ─── Convenience Command Builders ───────────────────────────────────────────

/**
 * Activate or deactivate the inspector overlay inside the iframe.
 *
 * @param iframe - Target preview iframe.
 * @param active - `true` to enable, `false` to disable.
 */
export function activateInspector(iframe: HTMLIFrameElement, active: boolean): boolean {
  return sendCommand(iframe, { type: 'INSPECTOR_ACTIVATE', active });
}

/**
 * Apply a single CSS property change to the currently selected element.
 *
 * @param iframe   - Target preview iframe.
 * @param property - CSS property name (e.g. `"color"`).
 * @param value    - New CSS value (e.g. `"red"`).
 */
export function editStyle(iframe: HTMLIFrameElement, property: string, value: string): boolean {
  return sendCommand(iframe, { type: 'INSPECTOR_EDIT_STYLE', property, value });
}

/**
 * Replace the text content of the currently selected element.
 *
 * @param iframe - Target preview iframe.
 * @param text   - New text content.
 */
export function editText(iframe: HTMLIFrameElement, text: string): boolean {
  return sendCommand(iframe, { type: 'INSPECTOR_EDIT_TEXT', text });
}

/**
 * Set an HTML attribute on the currently selected element.
 *
 * @param iframe    - Target preview iframe.
 * @param attribute - Attribute name (e.g. `"src"`, `"alt"`).
 * @param value     - New attribute value.
 */
export function editAttribute(iframe: HTMLIFrameElement, attribute: string, value: string): boolean {
  return sendCommand(iframe, { type: 'INSPECTOR_EDIT_ATTRIBUTE', attribute, value });
}

/**
 * Edit a CSS custom property (variable) on `:root`.
 *
 * @param iframe - Target preview iframe.
 * @param name   - Variable name including `--` prefix.
 * @param value  - New variable value.
 */
export function editCSSVar(iframe: HTMLIFrameElement, name: string, value: string): boolean {
  return sendCommand(iframe, { type: 'INSPECTOR_EDIT_CSS_VAR', name, value });
}

/**
 * Request a theme scan of the preview page.
 *
 * @param iframe - Target preview iframe.
 */
export function scanTheme(iframe: HTMLIFrameElement): boolean {
  return sendCommand(iframe, { type: 'INSPECTOR_SCAN_THEME' });
}

/**
 * Programmatically select an element by CSS selector.
 *
 * @param iframe   - Target preview iframe.
 * @param selector - CSS selector string.
 */
export function selectBySelector(iframe: HTMLIFrameElement, selector: string): boolean {
  return sendCommand(iframe, { type: 'INSPECTOR_SELECT_BY_SELECTOR', selector });
}

/**
 * Revert the most recent edit on the currently selected element.
 *
 * @param iframe - Target preview iframe.
 */
export function revertChanges(iframe: HTMLIFrameElement): boolean {
  return sendCommand(iframe, { type: 'INSPECTOR_REVERT' });
}

/**
 * Apply a CSS property change to every element matching `selector`.
 *
 * @param iframe   - Target preview iframe.
 * @param selector - CSS selector targeting multiple elements.
 * @param property - CSS property name.
 * @param value    - New CSS value.
 */
export function bulkEditStyle(iframe: HTMLIFrameElement, selector: string, property: string, value: string): boolean {
  return sendCommand(iframe, { type: 'INSPECTOR_BULK_STYLE', selector, property, value });
}

/**
 * Revert all bulk-applied changes for elements matching `selector`.
 *
 * @param iframe   - Target preview iframe.
 * @param selector - CSS selector used in the original bulk edit.
 */
export function bulkRevert(iframe: HTMLIFrameElement, selector: string): boolean {
  return sendCommand(iframe, { type: 'INSPECTOR_BULK_REVERT', selector });
}

/**
 * Count elements matching a CSS selector inside the preview.
 *
 * @param iframe   - Target preview iframe.
 * @param selector - CSS selector to count.
 */
export function countElements(iframe: HTMLIFrameElement, selector: string): boolean {
  return sendCommand(iframe, { type: 'INSPECTOR_COUNT_ELEMENTS', selector });
}

/**
 * Request a screenshot capture of the preview viewport.
 *
 * @param iframe    - Target preview iframe.
 * @param requestId - Unique identifier to correlate the response.
 * @param options   - Optional width/height overrides.
 */
export function requestScreenshot(
  iframe: HTMLIFrameElement,
  requestId: string,
  options: ScreenshotOptions = {},
): boolean {
  return sendCommand(iframe, { type: 'CAPTURE_SCREENSHOT_REQUEST', requestId, options });
}

/**
 * Delete the currently selected element from the DOM.
 *
 * @param iframe - Target preview iframe.
 */
export function deleteElement(iframe: HTMLIFrameElement): boolean {
  return sendCommand(iframe, { type: 'INSPECTOR_DELETE_ELEMENT' });
}
