import { useCallback, useEffect, useState } from 'react';
import { describeError } from '../api/errors';

/** Explicit loading / error / data state for every API-consuming view (RF-24). */
export interface AsyncResource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useAsync<T>(loader: () => Promise<T>, deps: readonly unknown[]): AsyncResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loader().then(
      (value) => {
        if (!cancelled) {
          setData(value);
          setLoading(false);
        }
      },
      (failure: unknown) => {
        if (!cancelled) {
          setError(describeError(failure));
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // The loader is re-created on every render by design; `deps` is the
    // declared dependency list of the calling screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload };
}
