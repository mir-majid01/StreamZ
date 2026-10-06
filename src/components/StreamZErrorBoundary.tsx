import React from 'react';
import { Box } from '@/components/ui/box';
import { StreamZErrorState } from '@/src/components/streamz';

/**
 * App-level boundary (PRD §13, §41): a crash renders a designed dead end with
 * a retry — never a raw red screen, stack trace, or blank surface. Details go
 * to the log only; the UI keeps the failure human.
 */
type State = { hasError: boolean };

export class StreamZErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown, info: unknown) {
    console.error('[boundary]', error, info);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <Box className="flex-1 bg-background">
          <StreamZErrorState
            title="Something went wrong"
            message="An unexpected error interrupted StreamZ."
            actionLabel="Try again"
            onAction={() => this.setState({ hasError: false })}
          />
        </Box>
      );
    }
    return this.props.children;
  }
}
