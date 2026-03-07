/**
 * Error Type Definitions
 *
 * Shared types for error handling across the application.
 *
 * @module types/errors
 */

/**
 * Error severity levels
 * - critical: Blocking errors that prevent functionality
 * - warning: Issues that should be addressed but don't block
 * - info: Informational messages, often suppressible
 */
export type ErrorSeverity = 'critical' | 'warning' | 'info';

/**
 * Error categories for filtering and handling
 */
export type ErrorCategory = 'root' | 'preview' | 'terminal' | 'module' | 'network' | 'build' | 'runtime';

/**
 * Error boundary fallback props
 */
export interface ErrorBoundaryFallbackProps {
  /** The error that was caught */
  error: Error;

  /** Function to reset the error boundary */
  resetErrorBoundary: () => void;

  /** Error category if known */
  category?: ErrorCategory;
}
