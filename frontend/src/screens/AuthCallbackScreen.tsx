import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { completeAuthorization } from '../auth/pkce';
import { homePathFor, useAuth } from '../auth/session';
import { describeError } from '../api/errors';
import { ErrorBanner, LoadingIndicator } from '../components/States';

/**
 * SCR-01 (second half) — authorization return.
 *
 * Handles `code` and `state` from the registered redirect URI, verifies the
 * state against the pending PKCE request and exchanges the code (EP-02).
 */
export function AuthCallbackScreen(): JSX.Element {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const code = params.get('code');
  const state = params.get('state');
  const failure = params.get('error');

  useEffect(() => {
    if (user !== null) {
      navigate(homePathFor(user), { replace: true });
      return;
    }
    if (failure !== null) {
      setError('The authorization server rejected the request.');
      return;
    }
    if (code === null || state === null) {
      setError('The authorization response is incomplete.');
      return;
    }
    let cancelled = false;
    completeAuthorization(code, state).then(
      () => {
        if (!cancelled) {
          navigate('/', { replace: true });
        }
      },
      (reason: unknown) => {
        if (!cancelled) {
          setError(describeError(reason));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [code, state, failure, user, navigate]);

  return (
    <section className="card auth-card">
      <h1>Completing sign in</h1>
      {error === null ? <LoadingIndicator label="Exchanging the authorization code…" /> : null}
      {error !== null ? <ErrorBanner message={error} /> : null}
    </section>
  );
}
