/**
 * Frontend runtime configuration.
 *
 * RF-26: no secrets live in the bundle. Only the public OAuth client id, the
 * registered redirect URI and the API base URL are declared here, and all of
 * them come from build-time environment variables with local defaults.
 */

const DEFAULT_API_URL = 'http://localhost:3000';

function readEnv(value: string | undefined, fallback: string): string {
  return value === undefined || value.trim() === '' ? fallback : value;
}

export const API_URL = readEnv(import.meta.env.VITE_API_URL, DEFAULT_API_URL).replace(/\/$/, '');

/** Public client registered by the backend (no client secret: PKCE only). */
export const OAUTH_CLIENT_ID = readEnv(import.meta.env.VITE_OAUTH_CLIENT_ID, 'medapp-spa');

/** The only redirect URI registered for the public client. */
export const OAUTH_REDIRECT_URI = readEnv(
  import.meta.env.VITE_OAUTH_REDIRECT_URI,
  `${window.location.origin}/auth/callback`,
);

/** Access token lifetime declared by the backend (RF-08): 15 minutes. */
export const ACCESS_TOKEN_TTL_SECONDS = 900;

/** Refresh token lifetime declared by the backend (RF-08): 8 hours. */
export const REFRESH_TOKEN_TTL_SECONDS = 28_800;

/** Proactive refresh happens this long before the access token expires. */
export const REFRESH_LEAD_SECONDS = 60;
