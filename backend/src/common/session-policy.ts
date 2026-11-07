/**
 * Token validity rules (RF-08), kept pure so they are unit-testable without a
 * database: a session is usable only while it is not revoked and its access
 * token has not reached its expiry instant.
 */
export interface SessionState {
  revoked: boolean;
  accessExpiresAt: Date;
}

export function isAccessTokenUsable(state: SessionState, now: number = Date.now()): boolean {
  if (state.revoked) {
    return false;
  }
  return state.accessExpiresAt.getTime() > now;
}

export interface RefreshState {
  revoked: boolean;
  refreshExpiresAt: Date;
}

export function isRefreshTokenUsable(state: RefreshState, now: number = Date.now()): boolean {
  if (state.revoked) {
    return false;
  }
  return state.refreshExpiresAt.getTime() > now;
}
