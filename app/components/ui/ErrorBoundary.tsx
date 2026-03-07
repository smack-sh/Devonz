/**
 * Reusable Error Boundary Component
 *
 * A generic error boundary that can be used throughout the application.
 * Provides consistent error handling with customizable fallback UI.
 *
 * @module components/ui/ErrorBoundary
 */

import React, { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { classNames } from '~/utils/classNames';
import type { ErrorCategory, ErrorBoundaryFallbackProps } from '~/types/errors';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('ErrorBoundary');

interface Props {
  /** Child components to wrap */
  children: ReactNode;

  /** Custom fallback component */
  fallback?: ReactNode | ((props: ErrorBoundaryFallbackProps) => ReactNode);

  /** Error category for context */
  category?: ErrorCategory;

  /** Callback when error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;

  /** Callback when boundary is reset */
  onReset?: () => void;

  /** Custom title for error display */
  title?: string;

  /** Custom description for error display */
  description?: string;

  /** Whether to show error details in development */
  showDetails?: boolean;

  /** Custom class name for the error container */
  className?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

/**
 * Generic Error Boundary Component
 *
 * Catches JavaScript errors anywhere in the child component tree,
 * logs them, and displays a fallback UI.
 *
 * @example
 * ```tsx
 * <ErrorBoundary category="preview" title="Preview Error">
 *   <PreviewComponent />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });

    // Log error with context
    logger.error(`Caught error${this.props.category ? ` (${this.props.category})` : ''}:`, error, errorInfo);

    // Call optional error handler
    this.props.onError?.(error, errorInfo);
  }

  resetErrorBoundary = (): void => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
    this.props.onReset?.();
  };

  render(): ReactNode {
    const { hasError, error } = this.state;

    if (hasError && error) {
      // Custom fallback renderer
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback({
          error,
          resetErrorBoundary: this.resetErrorBoundary,
          category: this.props.category,
        });
      }

      // Custom fallback element
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback UI
      return (
        <DefaultErrorFallback
          error={error}
          resetErrorBoundary={this.resetErrorBoundary}
          title={this.props.title}
          description={this.props.description}
          showDetails={this.props.showDetails ?? process.env.NODE_ENV === 'development'}
          className={this.props.className}
        />
      );
    }

    return this.props.children;
  }
}

/**
 * Default Error Fallback UI
 */
interface DefaultErrorFallbackProps {
  error: Error;
  resetErrorBoundary: () => void;
  title?: string;
  description?: string;
  showDetails?: boolean;
  className?: string;
}

function DefaultErrorFallback({
  error,
  resetErrorBoundary,
  title = 'Something went wrong',
  description = 'An unexpected error occurred.',
  showDetails = false,
  className,
}: DefaultErrorFallbackProps): JSX.Element {
  return (
    <div
      className={classNames(
        'flex flex-col items-center justify-center p-6 rounded-lg',
        'border border-devonz-elements-borderColor',
        'bg-devonz-elements-background-depth-2',
        'text-center min-h-[200px]',
        className,
      )}
    >
      {/* Error Icon */}
      <div className="i-ph:warning-circle-duotone text-4xl text-devonz-elements-button-danger-text mb-4" />

      {/* Title */}
      <h3 className="text-lg font-medium text-devonz-elements-textPrimary mb-2">{title}</h3>

      {/* Description */}
      <p className="text-sm text-devonz-elements-textSecondary mb-4 max-w-md">{description}</p>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={resetErrorBoundary}
          className={classNames(
            'px-4 py-2 rounded-lg text-sm font-medium',
            'bg-devonz-elements-button-primary-background',
            'text-devonz-elements-button-primary-text',
            'hover:bg-devonz-elements-button-primary-backgroundHover',
            'transition-colors duration-200',
          )}
        >
          Try Again
        </button>
      </div>

      {/* Error Details (Development Only) */}
      {showDetails && (
        <details className="mt-4 w-full max-w-lg text-left">
          <summary className="cursor-pointer text-sm text-devonz-elements-textTertiary hover:text-devonz-elements-textSecondary">
            Error Details
          </summary>
          <div className="mt-2 p-3 bg-devonz-elements-background-depth-3 rounded-lg overflow-auto">
            <p className="text-xs text-devonz-elements-textSecondary font-mono mb-2">
              {error.name}: {error.message}
            </p>
            {error.stack && (
              <pre className="text-xs text-devonz-elements-textTertiary whitespace-pre-wrap break-words">
                {error.stack}
              </pre>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * Lightweight Error Fallback for inline use
 */
export function InlineErrorFallback({
  _error,
  resetErrorBoundary,
  message = 'Failed to load',
}: {
  _error: Error;
  resetErrorBoundary: () => void;
  message?: string;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 p-2 text-sm text-devonz-elements-textSecondary">
      <div className="i-ph:warning text-yellow-500" />
      <span>{message}</span>
      <button
        onClick={resetErrorBoundary}
        className="text-devonz-elements-textTertiary hover:text-devonz-elements-textSecondary underline"
      >
        Retry
      </button>
    </div>
  );
}

/**
 * Preview-specific Error Fallback
 */
export function PreviewErrorFallback({ error, resetErrorBoundary }: ErrorBoundaryFallbackProps): JSX.Element {
  return (
    <div
      className={classNames(
        'flex flex-col items-center justify-center w-full h-full',
        'bg-devonz-elements-background-depth-1',
        'text-devonz-elements-textPrimary',
      )}
    >
      <div className="i-ph:monitor-duotone text-6xl text-devonz-elements-textTertiary mb-4" />
      <h3 className="text-lg font-medium mb-2">Preview Error</h3>
      <p className="text-sm text-devonz-elements-textSecondary mb-4 text-center max-w-md">
        The preview encountered an error. This might be a temporary issue.
      </p>
      <div className="flex gap-2">
        <button
          onClick={resetErrorBoundary}
          className={classNames(
            'px-4 py-2 rounded-lg text-sm font-medium',
            'bg-devonz-elements-button-primary-background',
            'text-devonz-elements-button-primary-text',
            'hover:bg-devonz-elements-button-primary-backgroundHover',
            'transition-colors duration-200',
          )}
        >
          Reload Preview
        </button>
      </div>
      {process.env.NODE_ENV === 'development' && (
        <details className="mt-4 max-w-lg text-left">
          <summary className="cursor-pointer text-xs text-devonz-elements-textTertiary">Technical Details</summary>
          <pre className="mt-2 p-2 bg-devonz-elements-background-depth-2 rounded text-xs overflow-auto max-h-32">
            {error.message}
          </pre>
        </details>
      )}
    </div>
  );
}

export default ErrorBoundary;
