import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { homePathFor, useAuth } from '../auth/session';
import { loginWithPassword } from '../auth/pkce';
import { describeError } from '../api/errors';
import { ErrorBanner } from '../components/States';

/**
 * SCR-01 — Login and authorization return.
 *
 * The screen renders the credentials form required by the testability contract
 * and runs the full authorization-code + PKCE flow (RF-18): a fresh verifier
 * and state are created locally, the backend login endpoint (EP-01) validates
 * the credentials and issues the code, and EP-02 exchanges it for tokens.
 * Client-side validation never replaces the server's (RF-21): the server error
 * envelope is displayed verbatim.
 */
export function LoginScreen(): JSX.Element {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user !== null) {
    return <Navigate to={homePathFor(user)} replace />;
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (email.trim() === '' || password === '') {
      setError('Email and password are required.');
      return;
    }
    setSubmitting(true);
    try {
      await loginWithPassword(email.trim(), password);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="card auth-card">
      <h1>Sign in</h1>
      <p className="hint">
        Outpatient appointments and clinical history. Authorization code flow with PKCE.
      </p>
      {error !== null ? <ErrorBanner message={error} /> : null}
      <form onSubmit={onSubmit} noValidate>
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="username"
          data-testid="login-email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          data-testid="login-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <button type="submit" data-testid="login-submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {submitting ? (
        <p className="state state-loading" data-testid="loading-indicator" role="status">
          Signing in…
        </p>
      ) : null}
    </section>
  );
}
