import { createHash, randomBytes } from 'node:crypto';

const API = 'http://localhost:3000';
const REDIRECT = 'http://localhost:8080/auth/callback';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Seed!Passw0rd';
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let failures = 0;
const results = [];
function check(name, condition, extra) {
  results.push(`${condition ? 'ok  ' : 'FAIL'} ${name}${condition || extra === undefined ? '' : ' :: ' + JSON.stringify(extra)}`);
  if (!condition) failures += 1;
}

async function call(path, { method = 'GET', token, body, headers = {}, formData } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text === '' ? null : JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

async function login(email) {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));
  const submit = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'medapp-spa',
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      state,
      email,
      password: PASSWORD,
    }),
    redirect: 'manual',
  });
  const location = submit.headers.get('location') ?? '';
  const code = new URL(location).searchParams.get('code');
  const tokenRes = await fetch(`${API}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, client_id: 'medapp-spa', redirect_uri: REDIRECT }),
  });
  const tokens = await tokenRes.json();
  return { ...tokens, status: tokenRes.status };
}

function utcDate(offset) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offset * 86400000)
    .toISOString()
    .slice(0, 10);
}

const admin = await login('admin@seed.local');
const staff = await login('staff@seed.local');
const p1 = await login('paciente1@seed.local');
const p2 = await login('paciente2@seed.local');
const p3 = await login('paciente3@seed.local');
const g1 = await login('gomez@seed.local');
const l1 = await login('lopez@seed.local');
check('all logins ok', [admin, staff, p1, p2, p3, g1, l1].every((t) => t.status === 200 && t.access_token));

// EP-20
const health = await call('/health');
check('EP-20 health body', health.status === 200 && health.json.status === 'ok', health.json);

// EP-05
const mine = await call('/me/appointments', { token: p1.access_token });
check('EP-05 200 array', mine.status === 200 && Array.isArray(mine.json), mine.json);
const mineNoAuth = await call('/me/appointments');
check('EP-05 401 without token', mineNoAuth.status === 401 && mineNoAuth.json.error.code === 'unauthorized', mineNoAuth.json);
const mineStaff = await call('/me/appointments', { token: staff.access_token });
check('EP-05 staff 403', mineStaff.status === 403, mineStaff.json);
const mineQuery = await call('/me/appointments?x=1', { token: p1.access_token });
check('EP-05 undeclared query 422', mineQuery.status === 422, mineQuery.json);

// EP-06
const day = utcDate(3);
const avail = await call(`/availability?professionalId=1&from=${day}&to=${day}`, { token: p1.access_token });
check('EP-06 slots shape', avail.status === 200 && Array.isArray(avail.json) && (avail.json.length === 0 || (typeof avail.json[0].start === 'string' && typeof avail.json[0].end === 'string')), avail.json);
const availBadRange = await call(`/availability?professionalId=1&from=${utcDate(5)}&to=${utcDate(3)}`, { token: p1.access_token });
check('EP-06 invalid range 422', availBadRange.status === 422, availBadRange.json);
const availBadProf = await call(`/availability?professionalId=999&from=${day}&to=${day}`, { token: p1.access_token });
check('EP-06 unknown professional 404', availBadProf.status === 404, availBadProf.json);
const availNoAuth = await call(`/availability?professionalId=1&from=${day}&to=${day}`);
check('EP-06 401 anon', availNoAuth.status === 401, availNoAuth.json);
const availMissing = await call('/availability?professionalId=1', { token: p1.access_token });
check('EP-06 missing from/to 422', availMissing.status === 422, availMissing.json);

// EP-07 validation + 401
const badBody = await call('/appointments', { method: 'POST', token: p1.access_token, body: { professionalId: 1, slotStart: `${day}T09:00:00.000Z`, extra: 1 } });
check('EP-07 undeclared field 422', badBody.status === 422, badBody.json);
const noBody = await call('/appointments', { method: 'POST', token: p1.access_token });
check('EP-07 missing body 422', noBody.status === 422, noBody.json);
const proBook = await call('/appointments', { method: 'POST', token: g1.access_token, body: { professionalId: 1, slotStart: `${day}T09:00:00.000Z` } });
check('EP-07 professional 403', proBook.status === 403, proBook.json);

// EP-10
const apptId = mine.json.length > 0 ? mine.json[0].id : null;
if (apptId !== null) {
  const own = await call(`/appointments/${apptId}`, { token: p1.access_token });
  check('EP-10 own 200', own.status === 200 && own.json.id === apptId, own.json);
  const other = await call(`/appointments/${apptId}`, { token: p2.access_token });
  check('EP-10 other patient 403', other.status === 403, other.json);
  const missing = await call('/appointments/999999', { token: p1.access_token });
  check('EP-10 missing 404', missing.status === 404, missing.json);
} else {
  check('EP-10 fixture appointment exists', false, 'no appointment in EP-05');
}

// EP-15..EP-18
const users = await call('/admin/users?page=1', { token: admin.access_token });
check('EP-15 paginated', users.status === 200 && Array.isArray(users.json.items) && typeof users.json.total === 'number', users.json);
const usersStaff = await call('/admin/users', { token: staff.access_token });
check('EP-15 staff 403', usersStaff.status === 403, usersStaff.json);
const auditNoAuth = await call('/admin/audit');
check('EP-19 anon 401', auditNoAuth.status === 401, auditNoAuth.json);

// unknown routes and methods
const unknown = await call('/nope');
check('unknown route 404 envelope', unknown.status === 404 && unknown.json?.error?.code, unknown.json);
const wrongMethod = await call('/health', { method: 'POST', body: {} });
check('wrong method clean envelope', wrongMethod.json?.error !== undefined, wrongMethod.json);

// RF-16: no internals
const internals = [unknown.text, wrongMethod.text, noBody.text, badBody.text];
check('no stack/sql/path leaks', internals.every((t) => !/at\s+\w+\s+\(|node_modules|\.ts:\d+|SELECT |INSERT |\/app\//i.test(t)), internals);

// token flows
const refreshed = await call('/auth/token/refresh', { method: 'POST', body: { refresh_token: p3.refresh_token } });
check('EP-03 refresh 200', refreshed.status === 200 && refreshed.json.access_token, refreshed.json);
const revoked = await call('/auth/revoke', { method: 'POST', body: { token: refreshed.json.refresh_token } });
check('EP-04 204', revoked.status === 204, revoked.status);
const afterRevoke = await call('/me/appointments', { token: refreshed.json.access_token });
check('RF-08 access dead after revoke', afterRevoke.status === 401, afterRevoke.json);
const refreshDead = await call('/auth/token/refresh', { method: 'POST', body: { refresh_token: refreshed.json.refresh_token } });
check('RF-08 refresh dead after revoke', refreshDead.status === 401, refreshDead.json);
const badVerifier = await call('/auth/token', { method: 'POST', body: { code: 'nope', code_verifier: 'a'.repeat(43), client_id: 'medapp-spa', redirect_uri: REDIRECT } });
check('EP-02 bad code 401', badVerifier.status === 401, badVerifier.json);

console.log(results.join('\n'));
console.log(failures === 0 ? '\nAUDIT PASSED' : `\n${failures} AUDIT FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
