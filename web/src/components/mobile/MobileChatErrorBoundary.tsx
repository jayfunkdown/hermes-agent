import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@nous-research/ui/ui/components/button";

interface MobileChatErrorBoundaryProps {
  children: ReactNode;
  onReload: () => void;
}

interface MobileChatErrorBoundaryState {
  hasError: boolean;
}

/** Prevent a single render failure from blanking the mobile chat surface. */
export class MobileChatErrorBoundary extends Component<
  MobileChatErrorBoundaryProps,
  MobileChatErrorBoundaryState
> {
  state: MobileChatErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): MobileChatErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Mobile chat render failed", error, info.componentStack);
  }

  private handleReload = (): void => {
    this.setState({ hasError: false });
    this.props.onReload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-destructive">This chat couldn&apos;t be displayed.</p>
          <Button outlined size="sm" onClick={this.handleReload}>
            Reload
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
