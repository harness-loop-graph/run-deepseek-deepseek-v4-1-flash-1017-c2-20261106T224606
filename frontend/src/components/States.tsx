/** Shared view states (RF-24): every API-consuming view renders these. */

export function LoadingIndicator({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return (
    <p className="state state-loading" data-testid="loading-indicator" role="status" aria-live="polite">
      {label}
    </p>
  );
}

export function ErrorBanner({ message }: { message: string }): JSX.Element {
  return (
    <p className="state state-error" data-testid="error-banner" role="alert">
      {message}
    </p>
  );
}

export function EmptyState({ message }: { message: string }): JSX.Element {
  return (
    <p className="state state-empty" data-testid="empty-state">
      {message}
    </p>
  );
}
