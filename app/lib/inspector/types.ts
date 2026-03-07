/**
 * Comprehensive type definitions for the Element Inspector system.
 *
 * Covers element selection, style editing, box-model visualisation,
 * hierarchy navigation, undo/redo history, bulk operations, and
 * user-configurable preferences.
 *
 * @module inspector/types
 */

/* Box-model */

/** Pixel values for `top`, `right`, `bottom`, `left`. */
export interface BoxSides {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Full box-model data used by the visual box-model editor. */
export interface BoxModelData {
  margin: BoxSides;
  padding: BoxSides;
  border: BoxSides;
  borderColor: string;
  borderStyle: string;
  width: number;
  height: number;
  boxSizing: string;
}

/* Element geometry */

/** Bounding-rect data for a DOM element. */
export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  left: number;
}

/* Element descriptors */

/** Lightweight element descriptor used in tree views and breadcrumbs. */
export interface ElementSummary {
  tagName: string;
  id: string;
  classes: string[];
  selector: string;
  displayText: string;
  hasChildren: boolean;
}

/** Parent / child / sibling tree around the currently-selected element. */
export interface ElementHierarchy {
  parents: ElementSummary[];
  current: ElementSummary | null;
  children: ElementSummary[];
  siblings: ElementSummary[];
  totalChildren: number;
  totalSiblings: number;
}

/** Full element data returned by the inspector runtime. */
export interface ElementInfo {
  tagName: string;
  className: string;
  id: string;
  textContent: string;
  styles: Record<string, string>;
  boxModel: BoxModelData | null;
  rect: ElementRect;
  selector: string;
  displayText: string;
  elementPath?: string;
  hierarchy: ElementHierarchy | null;
  colors: string[];

  /** `true` when the element is an `<img>` or has a CSS `background-image`. */
  isImage?: boolean;

  /** `src` attribute of an `<img>` element. */
  imageSrc?: string;

  /** `alt` attribute of an `<img>` element. */
  imageAlt?: string;

  /** Intrinsic width of an `<img>` element (pixels). */
  imageNaturalWidth?: number;

  /** Intrinsic height of an `<img>` element (pixels). */
  imageNaturalHeight?: number;

  /** Computed `background-image` value (when not `none`). */
  backgroundImage?: string;

  /** Source file path (from React devtools `__source` or `data-source-file`). */
  sourceFile?: string;

  /** Source line number. */
  sourceLine?: number;
}

/* Inspector modes & tabs */

/** Current operating mode of the inspector. */
export type InspectorMode = 'off' | 'inspect' | 'select';

/** Available detail-panel tabs. */
export type InspectorTab = 'styles' | 'box' | 'theme' | 'ai';

/* Edits & history */

/** A single CSS property change with undo information. */
export interface StyleEdit {
  property: string;
  oldValue: string;
  newValue: string;
  timestamp: number;
}

/** A text-content change with undo information. */
export interface TextEdit {
  oldText: string;
  newText: string;
  timestamp: number;
}

/** An HTML attribute change with undo information. */
export interface AttributeEdit {
  attribute: string;
  oldValue: string;
  newValue: string;
  timestamp: number;
}

/** Discriminated union for the undo / redo stack. */
export type EditHistoryEntry =
  | { kind: 'style'; edit: StyleEdit; elementSelector: string }
  | { kind: 'text'; edit: TextEdit; elementSelector: string }
  | { kind: 'attribute'; edit: AttributeEdit; elementSelector: string }
  | { kind: 'delete'; elementSelector: string; elementHtml: string; timestamp: number }
  | {
      kind: 'bulk-style';
      selector: string;
      property: string;
      oldValues: Map<string, string>;
      newValue: string;
      timestamp: number;
    };

/* Bulk operations */

/** Target descriptor for bulk style operations. */
export interface BulkTarget {
  value: string;
  label: string;
  selector: string;
}

/** Accumulated bulk style change. */
export interface BulkStyleChange {
  selector: string;
  property: string;
  value: string;
}

/* Screenshot */

/** Options for the viewport screenshot capture. */
export interface ScreenshotOptions {
  width?: number;
  height?: number;
}

/* Configuration */

/** User-configurable inspector preferences (persisted to storage). */
export interface InspectorConfig {
  highlightColor: string;
  showBoxModel: boolean;
  persistPanel: boolean;
  defaultTab: InspectorTab;
}

/** Sensible defaults for {@link InspectorConfig}. */
export const DEFAULT_INSPECTOR_CONFIG: Readonly<InspectorConfig> = {
  highlightColor: 'rgba(59, 130, 246, 0.3)',
  showBoxModel: true,
  persistPanel: true,
  defaultTab: 'styles',
} as const;

/* Style property allow-list */

/**
 * CSS properties the inspector displays and allows editing.
 *  SYNC: keep in sync with public/inspector/inspector-core.js RELEVANT_STYLE_PROPS
 */
export const RELEVANT_STYLE_PROPS = [
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
  'box-shadow',
  'opacity',
  'overflow',
] as const;

/* ─── Theme System ─────────────────────────────────────────────────── */

/** A CSS custom property (variable) discovered in the page. */
export interface CSSVariable {
  /** Variable name including `--` prefix, e.g. `--primary-color`. */
  name: string;

  /** Current computed value. */
  value: string;

  /** Whether the value resolves to a color. */
  isColor: boolean;

  /**
   * Usage count — how many elements reference this variable
   * (via `var(--name)` in their computed/inline styles).
   */
  usageCount: number;
}

/** A dominant color extracted from the page. */
export interface PageColor {
  /** The color value (hex or rgb). */
  value: string;

  /** Number of elements using this color. */
  count: number;

  /** CSS properties where this color appears most (e.g. `color`, `background-color`). */
  properties: string[];
}

/** A font family in use on the page. */
export interface PageFont {
  /** Font family name. */
  family: string;

  /** Number of elements using this font. */
  count: number;

  /** Font weights in use for this family. */
  weights: string[];
}

/** Complete theme data scanned from the page. */
export interface ThemeData {
  /** CSS custom properties (variables) found in `:root` / `html` / `body`. */
  variables: CSSVariable[];

  /** Dominant colors used across the page. */
  colors: PageColor[];

  /** Font families in use. */
  fonts: PageFont[];

  /** Timestamp of the scan. */
  timestamp: number;
}
