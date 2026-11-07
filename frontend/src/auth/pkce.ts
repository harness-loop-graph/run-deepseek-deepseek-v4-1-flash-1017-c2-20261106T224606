import { API_URL, OAUTH_CLIENT_ID, OAUTH_REDIRECT_URI } from '../config';
import { tokenManager } from './token-manager';
import type { TokenResponse } from '../api/types';

/**
 * OAuth 2.0 authorization code flow with PKCE (S256), RF-07/RF-18.
 *
 * The verifier never leaves the browser until the token exchange, and the
 * `state` value is checked on the redirect-back screen so a forged callback
 * cannot log the user into another session.
 */

const PKCE_STORAGE_KEY = 'medapp.pkce.v1';

interface PkceState {
  verifier: string;
  state: string;
  createdAt: number;
}

interface PkceRequest {
  verifier: string;
  state: string;
  challenge: string;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomUrlSafeString(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  window.crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await window.crypto.subtle.digest('SHA-256', encoded);
  return base64UrlEncode(new Uint8Array(digest));
}

/** Creates and stores a fresh PKCE verifier/state pair for one authorization request. */
async function startPkce(): Promise<PkceRequest> {
  const verifier = randomUrlSafeString(48);
  const state = randomUrlSafeString(24);
  const challenge = await createCodeChallenge(verifier);
  const pending: PkceState = { verifier, state, createdAt: Date.now() };
  window.sessionStorage.setItem(PKCE_STORAGE_KEY, JSON.stringify(pending));
  return { verifier, state, challenge };
}

function authorizationParams(request: PkceRequest): URLSearchParams {
  return new URLSearchParams({
    response_type: 'code',
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT_URI,
    code_challenge: request.challenge,
    code_challenge_method: 'S256',
    state: request.state,
  });
}

/** Starts the redirect flow: stores the PKCE verifier and visits EP-01. */
export async function beginAuthorization(): Promise<void> {
  const request = await startPkce();
  window.location.assign(`${API_URL}/auth/authorize?${authorizationParams(request).toString()}`);
}

function readPending(): PkceState | null {
  const raw = window.sessionStorage.getItem(PKCE_STORAGE_KEY);
  if (raw === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PkceState>;
    if (typeof parsed.verifier !== 'string' || typeof parsed.state !== 'string') {
      return null;
    }
    return {
      verifier: parsed.verifier,
      state: parsed.state,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
    };
  } catch {
    return null;
  }
}

export function clearPending(): void {
  window.sessionStorage.removeItem(PKCE_STORAGE_KEY);
}

async function exchangeCode(code: string, verifier: string): Promise<void> {
  const response = await fetch(`${API_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: verifier,
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: OAUTH_REDIRECT_URI,
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(body?.error?.message ?? 'The authorization code could not be exchanged.');
  }
  const tokens = (await response.json()) as TokenResponse;
  tokenManager.store(tokens);
}

/**
 * SCR-01 sign-in: the screen renders the credentials form, the authorization
 * request is created with PKCE, EP-01's login endpoint validates the
 * credentials and issues the authorization code, and EP-02 exchanges the code
 * for tokens. The verifier never leaves the browser before that exchange.
 */
export async function loginWithPassword(email: string, password: string): Promise<void> {
  const request = await startPkce();
  const response = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: OAUTH_REDIRECT_URI,
      code_challenge: request.challenge,
      state: request.state,
      email,
      password,
    }),
  });
  if (!response.ok) {
    clearPending();
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(body?.error?.message ?? 'Sign in failed. Check your credentials.');
  }
  const issued = (await response.json()) as { code: string; state: string };
  if (issued.state !== request.state) {
    clearPending();
    throw new Error('The authorization response does not match this session.');
  }
  await exchangeCode(issued.code, request.verifier);
  clearPending();
}

/** Redirect-back screen: validates `state` and exchanges `code` (EP-02). */
export async function completeAuthorization(code: string, returnedState: string): Promise<void> {
  const pending = readPending();
  if (pending === null) {
    throw new Error('No authorization request is in progress. Please sign in again.');
  }
  if (pending.state !== returnedState) {
    clearPending();
    throw new Error('The authorization response does not match this session. Please sign in again.');
  }
  await exchangeCode(code, pending.verifier);
  clearPending();
}
