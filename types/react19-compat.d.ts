/**
 * React 19 JSX namespace compatibility shim.
 *
 * @types/react@19 removed the global JSX namespace. This declaration re-exposes
 * it so existing code that references JSX.Element / JSX.IntrinsicElements
 * continues to compile without per-file imports.
 */
import type { JSX as ReactJSX } from 'react';

declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
    type IntrinsicElements = ReactJSX.IntrinsicElements;
    type ElementChildrenAttribute = ReactJSX.ElementChildrenAttribute;
  }
}
