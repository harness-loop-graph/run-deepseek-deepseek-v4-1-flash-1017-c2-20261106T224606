import { describe, expect, it } from 'vitest';
import {
  isAccessTokenUsable,
  isRefreshTokenUsable,
} from '../src/common/session-policy';

/**
 * RF-08: tokens carry an explicit expiry and revocation is immediate. The rules
 * are pure functions so the policy can be asserted without a database; the
 * TokenService and AuthService apply them on every request.
 */

const NOW = Date.parse('2030-01-07T09:00:00.000Z');

describe('access token policy', () => {
  it('accepts a live token', () => {
    expect(
      isAccessTokenUsable({ revoked: false, accessExpiresAt: new Date(NOW + 60_000) }, NOW),
    ).toBe(true);
  });

  it('rejects an expired token', () => {
    expect(
      isAccessTokenUsable({ revoked: false, accessExpiresAt: new Date(NOW - 1) }, NOW),
    ).toBe(false);
  });

  it('rejects a token whose exact expiry instant has been reached', () => {
    expect(isAccessTokenUsable({ revoked: false, accessExpiresAt: new Date(NOW) }, NOW)).toBe(
      false,
    );
  });

  it('rejects a revoked token even before it expires', () => {
    expect(
      isAccessTokenUsable({ revoked: true, accessExpiresAt: new Date(NOW + 3_600_000) }, NOW),
    ).toBe(false);
  });
});

describe('refresh token policy', () => {
  it('accepts a live refresh token', () => {
    expect(
      isRefreshTokenUsable({ revoked: false, refreshExpiresAt: new Date(NOW + 3_600_000) }, NOW),
    ).toBe(true);
  });

  it('rejects an expired refresh token', () => {
    expect(
      isRefreshTokenUsable({ revoked: false, refreshExpiresAt: new Date(NOW - 1) }, NOW),
    ).toBe(false);
  });

  it('rejects a revoked refresh token', () => {
    expect(
      isRefreshTokenUsable({ revoked: true, refreshExpiresAt: new Date(NOW + 3_600_000) }, NOW),
    ).toBe(false);
  });
});
