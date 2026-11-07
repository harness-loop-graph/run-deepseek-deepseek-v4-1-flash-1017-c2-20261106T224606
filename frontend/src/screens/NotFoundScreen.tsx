import { Link } from 'react-router-dom';

export function NotFoundScreen(): JSX.Element {
  return (
    <section className="card">
      <h1>Page not found</h1>
      <p className="hint">The requested screen does not exist.</p>
      <Link to="/">Back to sign in</Link>
    </section>
  );
}
