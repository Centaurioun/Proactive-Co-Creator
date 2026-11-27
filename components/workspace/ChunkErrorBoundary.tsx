/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, type ErrorInfo, type ReactNode } from 'react';

export function createRetryableLazy<TProps extends object>(
  createLazy: () => React.LazyExoticComponent<React.ComponentType<TProps>>
) {
  let LazyComponent = createLazy();
  const retry = () => {
    LazyComponent = createLazy();
  };
  const ComponentWrapper: React.FC<TProps> = (props) => <LazyComponent {...props} />;
  return { Component: ComponentWrapper, retry };
}

interface ChunkErrorBoundaryProps {
  resetKey: string | number;
  viewLabel: string;
  onRetry?: () => void;
  onReturnToWorkspace?: () => void;
  returnLabel?: string;
  children: ReactNode;
}

interface ChunkErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  attempt: number;
}

export default class ChunkErrorBoundary extends Component<
  ChunkErrorBoundaryProps,
  ChunkErrorBoundaryState
> {
  state: ChunkErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
    attempt: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<ChunkErrorBoundaryState> {
    return {
      hasError: true,
      errorMessage: error.message || 'Could not load workspace module.',
    };
  }

  componentDidUpdate(prevProps: ChunkErrorBoundaryProps): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.props.onRetry?.();
      this.setState({ hasError: false, errorMessage: '' });
    }
  }

  componentWillUnmount(): void {
    if (this.state.hasError) {
      this.props.onRetry?.();
    }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Error UI is surfaced via getDerivedStateFromError.
  }

  private handleRetry = () => {
    this.props.onRetry?.();
    this.setState((prev) => ({
      hasError: false,
      errorMessage: '',
      attempt: prev.attempt + 1,
    }));
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="m-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
        >
          <p className="font-semibold">
            Could not load {this.props.viewLabel}.
          </p>
          <p className="mt-1 text-xs opacity-90">{this.state.errorMessage}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={this.handleRetry}
              className="min-h-10 rounded-md bg-pcc-action px-3 py-1.5 text-xs font-semibold text-white hover:bg-pcc-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus"
            >
              Retry
            </button>
            {this.props.onReturnToWorkspace && (
              <button
                type="button"
                onClick={this.props.onReturnToWorkspace}
                className="min-h-10 rounded-md border border-pcc-line bg-pcc-surface px-3 py-1.5 text-xs font-medium text-pcc-ink hover:bg-pcc-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus dark:border-pcc-dark-line dark:bg-pcc-dark-surface dark:text-pcc-dark-ink"
              >
                {this.props.returnLabel ?? 'Return to workspace'}
              </button>
            )}
          </div>
        </div>
      );
    }

    return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
  }
}
