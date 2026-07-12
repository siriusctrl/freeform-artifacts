import { Component, type ErrorInfo, type ReactNode } from "react";

interface ArtifactErrorBoundaryProps {
  children: ReactNode;
  fallback: (message: string) => ReactNode;
}

interface ArtifactErrorBoundaryState {
  message: string | null;
}

export class ArtifactErrorBoundary extends Component<
  ArtifactErrorBoundaryProps,
  ArtifactErrorBoundaryState
> {
  state: ArtifactErrorBoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): ArtifactErrorBoundaryState {
    return {
      message: error instanceof Error ? error.message : "The artifact renderer failed",
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Artifact render failed", error, info.componentStack);
  }

  render() {
    return this.state.message ? this.props.fallback(this.state.message) : this.props.children;
  }
}
