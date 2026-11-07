import { API_URL, ACCESS_TOKEN_TTL_SECONDS, REFRESH_LEAD_SECONDS } from '../config';
import type { SessionUser, TokenResponse } from '../api/types';

/**
 * Token policy (RF-08 / RF-23).
 *
 * Storage: tokens live in `sessionStorage`, never in `localStorage`, so they
 * disappear when the tab closes and are not shared across tabs. Nothing
 * sensitive is written to a URL, a cookie or the bundle.
 *
 * Refresh: the access token lasts 15 minutes. Before every API call the
 * manager checks the expiry and refreshes proactively `REFRESH_LEAD_SECONDS`
 * before it lapses; a 401 also triggers exactly one refresh attempt. Refresh
 * calls are single-flight, so concurrent requests share one rotation.
 *
 * Logout: the refresh token is revoked with EP-04 and the stored tokens are
 * cleared whether or not the revocation call succeeds.
 */

const STORAGE_KEY = 'medapp.session.v1';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  user: SessionUser;
}

type Listener = (session: StoredSession | null) => void;

function isSessionUser(value: unknown): value is SessionUser {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'number' &&
    typeof candidate.email === 'string' &&
    Array.isArray(candidate.roles) &&
    (candidate.patientId === null || typeof candidate.patientId === 'number') &&
    (candidate.professionalId === null || typeof candidate.professionalId === 'number')
  );
}

function parseStored(raw: string | null): StoredSession | null {
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.accessToken !== 'string' ||
      typeof candidate.refreshToken !== 'string' ||
      typeof candidate.accessExpiresAt !== 'number' ||
      typeof candidate.refreshExpiresAt !== 'number' ||
      !isSessionUser(candidate.user)
    ) {
      return null;
    }
    return {
      accessToken: candidate.accessToken,
      refreshToken: candidate.refreshToken,
      accessExpiresAt: candidate.accessExpiresAt,
      refreshExpiresAt: candidate.refreshExpiresAt,
      user: candidate.user,
    };
  } catch {
    return null;
  }
}

class TokenManager {
  private session: StoredSession | null = null;
  private listeners = new Set<Listener>();
  private refreshInFlight: Promise<StoredSession | null> | null = null;
  private loaded = false;

  private load(): StoredSession | null {
    if (!this.loaded) {
      this.loaded = true;
      this.session = parseStored(window.sessionStorage.getItem(STORAGE_KEY));
    }
    return this.session;
  }

  private persist(session: StoredSession | null): void {
    this.session = session;
    if (session === null) {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    }
    for (const listener of this.listeners) {
      listener(session);
    }
  }

  getSession(): StoredSession | null {
    return this.load();
  }

  getUser(): SessionUser | null {
    return this.load()?.user ?? null;
  }

  isAuthenticated(): boolean {
    const session = this.load();
    return session !== null && session.refreshExpiresAt > Date.now();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  store(tokens: TokenResponse): StoredSession {
    const now = Date.now();
    const session: StoredSession = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessExpiresAt: now + (tokens.expires_in || ACCESS_TOKEN_TTL_SECONDS) * 1000,
      refreshExpiresAt: now + tokens.refresh_expires_in * 1000,
      user: tokens.user,
    };
    this.loaded = true;
    this.persist(session);
    return session;
  }

  clear(): void {
    this.loaded = true;
    this.persist(null);
  }

  /**
   * Returns a usable access token, refreshing proactively when the current
   * one is about to expire. Resolves to null when the session is gone.
   */
  async getAccessToken(): Promise<string | null> {
    const session = this.load();
    if (session === null) {
      return null;
    }
    if (session.refreshExpiresAt <= Date.now()) {
      this.clear();
      return null;
    }
    if (session.accessExpiresAt - REFRESH_LEAD_SECONDS * 1000 > Date.now()) {
      return session.accessToken;
    }
    const refreshed = await this.refresh();
    return refreshed?.accessToken ?? null;
  }

  /** Single-flight refresh: concurrent callers share one rotation. */
  async refresh(): Promise<StoredSession | null> {
    if (this.refreshInFlight !== null) {
      return this.refreshInFlight;
    }
    const current = this.load();
    if (current === null) {
      return null;
    }
    this.refreshInFlight = this.performRefresh(current.refreshToken).finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async performRefresh(refreshToken: string): Promise<StoredSession | null> {
    try {
      const response = await fetch(`${API_URL}/auth/token/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!response.ok) {
        this.clear();
        return null;
      }
      const tokens = (await response.json()) as TokenResponse;
      return this.store(tokens);
    } catch {
      // Network failure: keep the session so a later call can retry.
      return this.load();
    }
  }

  /** RF-23: logout revokes the refresh token (EP-04) and always clears storage. */
  async logout(): Promise<void> {
    const session = this.load();
    this.clear();
    if (session === null) {
      return;
    }
    try {
      await fetch(`${API_URL}/auth/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: session.refreshToken }),
      });
    } catch {
      // The local session is already gone; a failed revoke must not block logout.
    }
  }
}

export const tokenManager = new TokenManager();
