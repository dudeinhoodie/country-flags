import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { BlockingScreen } from "./BlockingScreen";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | undefined;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // No error reporting adapter exists yet; the console keeps the stack
    // reachable for an operator without shipping data anywhere.
    console.error("Unhandled error in the admin console", error, errorInfo);
  }

  override render(): ReactNode {
    if (this.state.error !== undefined) {
      return (
        <BlockingScreen
          title="The admin console crashed"
          message={this.state.error.message}
          hint="Reload the page. If the crash repeats, report it with the browser console output."
        />
      );
    }
    return this.props.children;
  }
}
