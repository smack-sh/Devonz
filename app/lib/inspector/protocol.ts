/**
 * Inspector Message Protocol
 *
 * Typed message contract between the parent window and the preview iframe.
 * Every message flowing through `postMessage` must conform to one of the
 * discriminated unions defined here.  Type guards and lookup sets are
 * provided so consumers never need to cast or guess.
 */

import type { ElementInfo, ThemeData } from './types';

// ─── Screenshot Options ─────────────────────────────────────────────────────

/** Options forwarded with a screenshot capture request. */
export interface ScreenshotOptions {
  width?: number;
  height?: number;
}

// ─── Message Type Constants ─────────────────────────────────────────────────

/** All valid command type strings (parent → iframe). */
export const INSPECTOR_COMMAND_TYPES = [
  'INSPECTOR_ACTIVATE',
  'INSPECTOR_EDIT_STYLE',
  'INSPECTOR_EDIT_TEXT',
  'INSPECTOR_EDIT_ATTRIBUTE',
  'INSPECTOR_EDIT_CSS_VAR',
  'INSPECTOR_SCAN_THEME',
  'INSPECTOR_SELECT_BY_SELECTOR',
  'INSPECTOR_REVERT',
  'INSPECTOR_BULK_STYLE',
  'INSPECTOR_BULK_REVERT',
  'INSPECTOR_COUNT_ELEMENTS',
  'CAPTURE_SCREENSHOT_REQUEST',
  'INSPECTOR_DELETE_ELEMENT',
] as const;

/** All valid event type strings (iframe → parent). */
export const INSPECTOR_EVENT_TYPES = [
  'INSPECTOR_READY',
  'INSPECTOR_HOVER',
  'INSPECTOR_LEAVE',
  'INSPECTOR_CLICK',
  'INSPECTOR_RESIZE',
  'INSPECTOR_RESIZE_END',
  'INSPECTOR_EDIT_APPLIED',
  'INSPECTOR_TEXT_APPLIED',
  'INSPECTOR_REVERTED',
  'INSPECTOR_BULK_APPLIED',
  'INSPECTOR_BULK_REVERTED',
  'INSPECTOR_ELEMENT_COUNT',
  'INSPECTOR_ELEMENT_DELETED',
  'INSPECTOR_ATTRIBUTE_APPLIED',
  'INSPECTOR_CSS_VAR_APPLIED',
  'INSPECTOR_THEME_DATA',
  'PREVIEW_CONSOLE_ERROR',
  'PREVIEW_VITE_ERROR',
  'PREVIEW_SCREENSHOT_RESPONSE',
] as const;

/** Union of every command type literal. */
export type InspectorCommandType = (typeof INSPECTOR_COMMAND_TYPES)[number];

/** Union of every event type literal. */
export type InspectorEventType = (typeof INSPECTOR_EVENT_TYPES)[number];

/** Union of every message type literal (command + event). */
export type InspectorMessageType = InspectorCommandType | InspectorEventType;

/** Fast `Set` for O(1) membership checks on command types. */
export const COMMAND_TYPE_SET: ReadonlySet<string> = new Set<string>(INSPECTOR_COMMAND_TYPES);

/** Fast `Set` for O(1) membership checks on event types. */
export const EVENT_TYPE_SET: ReadonlySet<string> = new Set<string>(INSPECTOR_EVENT_TYPES);

/** Fast `Set` for O(1) membership checks on all message types. */
export const MESSAGE_TYPE_SET: ReadonlySet<string> = new Set<string>([
  ...INSPECTOR_COMMAND_TYPES,
  ...INSPECTOR_EVENT_TYPES,
]);

// ─── Parent → Iframe Commands ───────────────────────────────────────────────

/** Activate or deactivate the inspector overlay inside the iframe. */
export interface ActivateCommand {
  type: 'INSPECTOR_ACTIVATE';
  active: boolean;
}

/** Apply a single CSS property change to the currently selected element. */
export interface EditStyleCommand {
  type: 'INSPECTOR_EDIT_STYLE';
  property: string;
  value: string;
}

/** Replace the text content of the currently selected element. */
export interface EditTextCommand {
  type: 'INSPECTOR_EDIT_TEXT';
  text: string;
}

/** Programmatically select an element by CSS selector. */
export interface SelectBySelectorCommand {
  type: 'INSPECTOR_SELECT_BY_SELECTOR';
  selector: string;
}

/** Revert the most recent edit on the currently selected element. */
export interface RevertCommand {
  type: 'INSPECTOR_REVERT';
}

/** Apply a CSS property change to every element matching `selector`. */
export interface BulkStyleCommand {
  type: 'INSPECTOR_BULK_STYLE';
  selector: string;
  property: string;
  value: string;
}

/** Revert all bulk-applied changes for elements matching `selector`. */
export interface BulkRevertCommand {
  type: 'INSPECTOR_BULK_REVERT';
  selector: string;
}

/** Count elements matching the given CSS selector. */
export interface CountElementsCommand {
  type: 'INSPECTOR_COUNT_ELEMENTS';
  selector: string;
}

/** Request a screenshot of the preview viewport. */
export interface CaptureScreenshotRequestCommand {
  type: 'CAPTURE_SCREENSHOT_REQUEST';
  requestId: string;
  options: ScreenshotOptions;
}

/** Set an HTML attribute on the currently selected element. */
export interface EditAttributeCommand {
  type: 'INSPECTOR_EDIT_ATTRIBUTE';
  attribute: string;
  value: string;
}

/** Edit a CSS custom property (variable) on `:root`. */
export interface EditCSSVarCommand {
  type: 'INSPECTOR_EDIT_CSS_VAR';
  name: string;
  value: string;
}

/** Request a full theme scan of the preview page. */
export interface ScanThemeCommand {
  type: 'INSPECTOR_SCAN_THEME';
}

/** Delete the currently selected element from the DOM. */
export interface DeleteElementCommand {
  type: 'INSPECTOR_DELETE_ELEMENT';
}

/**
 * Discriminated union of every command the parent window can send
 * to the preview iframe.
 */
export type InspectorCommand =
  | ActivateCommand
  | EditStyleCommand
  | EditTextCommand
  | EditAttributeCommand
  | EditCSSVarCommand
  | ScanThemeCommand
  | SelectBySelectorCommand
  | RevertCommand
  | BulkStyleCommand
  | BulkRevertCommand
  | CountElementsCommand
  | CaptureScreenshotRequestCommand
  | DeleteElementCommand;

// ─── Iframe → Parent Events ─────────────────────────────────────────────────

/** Sent once the inspector bridge script has initialised inside the iframe. */
export interface ReadyEvent {
  type: 'INSPECTOR_READY';
}

/** Sent while the cursor hovers over an element in inspect mode. */
export interface HoverEvent {
  type: 'INSPECTOR_HOVER';
  elementInfo: ElementInfo;
}

/** Sent when the cursor leaves all elements (e.g. exits the viewport). */
export interface LeaveEvent {
  type: 'INSPECTOR_LEAVE';
}

/** Sent when the user clicks an element to select it. */
export interface ClickEvent {
  type: 'INSPECTOR_CLICK';
  elementInfo: ElementInfo;
}

/** Sent continuously while an element is being drag-resized. */
export interface ResizeEvent {
  type: 'INSPECTOR_RESIZE';
  width: number;
  height: number;
}

/** Sent when a drag-resize interaction ends. */
export interface ResizeEndEvent {
  type: 'INSPECTOR_RESIZE_END';
  elementInfo: ElementInfo;

  /** Element width (px) at the start of the drag. */
  oldWidth: number;

  /** Element height (px) at the start of the drag. */
  oldHeight: number;
}

/** Confirmation that a single style edit was applied (or failed). */
export interface EditAppliedEvent {
  type: 'INSPECTOR_EDIT_APPLIED';
  property: string;
  value: string;
  success: boolean;
  error?: string;
}

/** Confirmation that a text-content edit was applied (or failed). */
export interface TextAppliedEvent {
  type: 'INSPECTOR_TEXT_APPLIED';
  text: string;
  success: boolean;
  error?: string;
}

/** Confirmation that the last edit was reverted (or failed). */
export interface RevertedEvent {
  type: 'INSPECTOR_REVERTED';
  elementInfo?: ElementInfo;
  success: boolean;
  error?: string;
}

/** Confirmation that a bulk style change was applied (or failed). */
export interface BulkAppliedEvent {
  type: 'INSPECTOR_BULK_APPLIED';
  selector: string;
  property: string;
  value: string;
  count: number;
  success: boolean;
  error?: string;
}

/** Confirmation that bulk changes were reverted (or failed). */
export interface BulkRevertedEvent {
  type: 'INSPECTOR_BULK_REVERTED';
  selector: string;
  count: number;
  success: boolean;
  error?: string;
}

/** Response to a `COUNT_ELEMENTS` command. */
export interface ElementCountEvent {
  type: 'INSPECTOR_ELEMENT_COUNT';
  selector: string;
  count: number;
  error?: string;
}

/** Confirmation that the selected element was deleted (or failed). */
export interface ElementDeletedEvent {
  type: 'INSPECTOR_ELEMENT_DELETED';
  success: boolean;
  error?: string;
}

/** Confirmation that an HTML attribute edit was applied (or failed). */
export interface AttributeAppliedEvent {
  type: 'INSPECTOR_ATTRIBUTE_APPLIED';
  attribute: string;
  value: string;
  oldValue: string;
  success: boolean;
  error?: string;
}

/** Confirmation that a CSS variable edit was applied (or failed). */
export interface CSSVarAppliedEvent {
  type: 'INSPECTOR_CSS_VAR_APPLIED';
  name: string;
  value: string;
  oldValue: string;
  success: boolean;
  error?: string;
}

/** Theme scan results from the preview page. */
export interface ThemeDataEvent {
  type: 'INSPECTOR_THEME_DATA';
  theme: ThemeData;
}

/** Forwarded `window.onerror` / `console.error` from the preview app. */
export interface ConsoleErrorEvent {
  type: 'PREVIEW_CONSOLE_ERROR';
  errorType: string;
  message: string;
  stack: string;
  url: string;
  timestamp: number;
}

/** Forwarded Vite HMR / build error from the preview app. */
export interface ViteErrorEvent {
  type: 'PREVIEW_VITE_ERROR';
  errorType: string;
  message: string;
  fullMessage: string;
  file: string;
  stack: string;
  url: string;
  timestamp: number;
}

/** Screenshot data returned in response to a `CAPTURE_SCREENSHOT_REQUEST`. */
export interface ScreenshotResponseEvent {
  type: 'PREVIEW_SCREENSHOT_RESPONSE';
  requestId: string;
  dataUrl: string;
  isPlaceholder: boolean;
  timestamp: number;
}

/**
 * Discriminated union of every event the preview iframe can send
 * to the parent window.
 */
export type InspectorEvent =
  | ReadyEvent
  | HoverEvent
  | LeaveEvent
  | ClickEvent
  | ResizeEvent
  | ResizeEndEvent
  | EditAppliedEvent
  | TextAppliedEvent
  | RevertedEvent
  | BulkAppliedEvent
  | BulkRevertedEvent
  | ElementCountEvent
  | ElementDeletedEvent
  | AttributeAppliedEvent
  | CSSVarAppliedEvent
  | ThemeDataEvent
  | ConsoleErrorEvent
  | ViteErrorEvent
  | ScreenshotResponseEvent;

// ─── Combined Message Type ──────────────────────────────────────────────────

/** Any valid inspector message flowing through `postMessage`. */
export type InspectorMessage = InspectorCommand | InspectorEvent;

// ─── Type Guards ────────────────────────────────────────────────────────────

/**
 * Narrow an unknown `postMessage` payload to {@link InspectorCommand}.
 *
 * Validates that the payload is a non-null object with a `type` property
 * whose value belongs to the set of known command types.
 */
export function isInspectorCommand(data: unknown): data is InspectorCommand {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    typeof (data as Record<string, unknown>).type === 'string' &&
    COMMAND_TYPE_SET.has((data as Record<string, unknown>).type as string)
  );
}

/**
 * Narrow an unknown `postMessage` payload to {@link InspectorEvent}.
 *
 * Validates that the payload is a non-null object with a `type` property
 * whose value belongs to the set of known event types.
 */
export function isInspectorEvent(data: unknown): data is InspectorEvent {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    typeof (data as Record<string, unknown>).type === 'string' &&
    EVENT_TYPE_SET.has((data as Record<string, unknown>).type as string)
  );
}

/**
 * Narrow an unknown `postMessage` payload to {@link InspectorMessage}.
 *
 * Returns `true` when the value is either a valid command *or* a valid event.
 */
export function isInspectorMessage(data: unknown): data is InspectorMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    typeof (data as Record<string, unknown>).type === 'string' &&
    MESSAGE_TYPE_SET.has((data as Record<string, unknown>).type as string)
  );
}
