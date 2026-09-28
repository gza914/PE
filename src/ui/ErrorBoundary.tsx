import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Shown in the fallback; the whole-app boundary offers a new game, panel boundaries just a retry. */
  label: string;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * Catches a crash in part of the UI so the rest keeps working, instead of
 * React unmounting everything and leaving a blank screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.label}]`, error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <strong>Something broke in the {this.props.label}.</strong>
        <p className="small muted mono">{this.state.error.message}</p>
        <button
          className="small"
          onClick={() => {
            this.props.onReset?.();
            this.setState({ error: null });
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
