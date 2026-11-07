import { createHash, randomBytes } from 'node:crypto';

const API = 'http://localhost:3000';
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const verifier = b64url(randomBytes(48));
const challenge = b64url(createHash('sha256').update(verifier).digest());
const state = b64url(randomBytes(16));

const authz = await fetch(
  `${API}/auth/authorize?response_type=code&client_id=medapp-spa&redirect_uri=${encodeURIComponent('http://localhost:8080/auth/callback')}&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`,
  { redirect: 'manual' },
);
console.log('EP-01 status', authz.status, authz.headers.get('location')?.slice(0, 60));

const loginUrl = authz.headers.get('location');
const page = await fetch(loginUrl);
const html = await page.text();
console.log(
  'form page',
  page.status,
  ['name="email"', 'name="password"', 'type="submit"', 'method="post"'].every((t) => html.includes(t)),
);

const body = new URLSearchParams({
  client_id: 'medapp-spa',
  redirect_uri: 'http://localhost:8080/auth/callback',
  code_challenge: challenge,
  state,
  email: 'gomez@seed.local',
  password: 'Seed!Passw0rd',
});
const submit = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body,
  redirect: 'manual',
});
const location = submit.headers.get('location') ?? '';
console.log('form submit', submit.status, location.slice(0, 90));
const redirect = new URL(location);
const code = redirect.searchParams.get('code');
console.log('code+state present', code !== null, redirect.searchParams.get('state') === state);

const tokenRes = await fetch(`${API}/auth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    code,
    code_verifier: verifier,
    client_id: 'medapp-spa',
    redirect_uri: 'http://localhost:8080/auth/callback',
  }),
});
const tokens = await tokenRes.json();
console.log('EP-02', tokenRes.status, typeof tokens.access_token === 'string', tokens.user?.roles);

const agenda = await fetch(`${API}/agenda`, {
  headers: { Authorization: `Bearer ${tokens.access_token}` },
});
const agendaBody = await agenda.json();
console.log('EP-09', agenda.status, Array.isArray(agendaBody));
