import React, { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { Button } from '~/components/ui/Button';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('PanelErrorBoundary');

interface PanelErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  panelName: string;
}

interface PanelErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  constructor(props: PanelErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error(`[${this.props.panelName}] Caught error:`, error, errorInfo);

    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center p-8 text-center space-y-4 bg-devonz-elements-background-depth-1 border border-devonz-elements-borderColor rounded-lg w-full h-full">
          <div className="w-12 h-12 rounded-full bg-red-900/20 flex items-center justify-center">
            <div className="i-ph:warning w-6 h-6 text-red-500" />
          </div>

          <div>
            <h3 className="text-lg font-medium text-devonz-elements-textPrimary mb-2">{this.props.panelName} Error</h3>
            <p className="text-sm text-devonz-elements-textSecondary mb-4 max-w-md">
              Something went wrong in the {this.props.panelName} panel. You can try again or reload the page.
            </p>

            {this.state.error && (
              <details className="text-xs text-devonz-elements-textTertiary mb-4">
                <summary className="cursor-pointer hover:text-devonz-elements-textSecondary">
                  Show error details
                </summary>
                <pre className="mt-2 p-2 bg-devonz-elements-background-depth-2 rounded text-left overflow-auto max-h-40">
                  {this.state.error.message}
                </pre>
              </details>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={this.handleRetry}>
              Try Again
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              Reload Page
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/** Higher-order component for wrapping any panel with PanelErrorBoundary */
export function withPanelErrorBoundary<P extends object>(component: React.ComponentType<P>, panelName: string) {
  function WithPanelErrorBoundaryWrapper(props: P) {
    return <PanelErrorBoundary panelName={panelName}>{React.createElement(component, props)}</PanelErrorBoundary>;
  }

  WithPanelErrorBoundaryWrapper.displayName = `withPanelErrorBoundary(${
    component.displayName || component.name || 'Component'
  })`;

  return WithPanelErrorBoundaryWrapper;
}
