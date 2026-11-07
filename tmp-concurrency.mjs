import { createHash, randomBytes } from 'node:crypto';

const API = 'http://localhost:3000';
const REDIRECT = 'http://localhost:8080/auth/callback';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Seed!Passw0rd';
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let failures = 0;
const out = [];
function check(name, condition, extra) {
  out.push(`${condition ? 'ok  ' : 'FAIL'} ${name}${condition || extra === undefined ? '' : ' :: ' + JSON.stringify(extra)}`);
  if (!condition) failures += 1;
}

async function call(path, { method = 'GET', token, body } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text === '' ? null : JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, headers: res.headers };
}

async function login(email) {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));
  const submit = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: 'medapp-spa', redirect_uri: REDIRECT, code_challenge: challenge, state, email, password: PASSWORD }),
    redirect: 'manual',
  });
  const code = new URL(submit.headers.get('location') ?? '').searchParams.get('code');
  const res = await fetch(`${API}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, client_id: 'medapp-spa', redirect_uri: REDIRECT }),
  });
  return res.json();
}

function utcDate(offset) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offset * 86400000).toISOString().slice(0, 10);
}

const p1 = await login('paciente1@seed.local');
const p2 = await login('paciente2@seed.local');

// find a free slot at least 5 days ahead
let slot = null;
for (let offset = 5; offset <= 12 && slot === null; offset += 1) {
  const day = utcDate(offset);
  const res = await call(`/availability?professionalId=1&from=${day}&to=${day}`, { token: p1.access_token });
  if (res.status === 200 && res.json.length > 0) slot = res.json[0];
}
check('free slot found', slot !== null);

const [a, b] = await Promise.all([
  call('/appointments', { method: 'POST', token: p1.access_token, body: { professionalId: 1, slotStart: slot.start } }),
  call('/appointments', { method: 'POST', token: p2.access_token, body: { professionalId: 1, slotStart: slot.start } }),
]);
const statuses = [a.status, b.status].sort();
check('concurrent booking one 201 one 409', statuses[0] === 201 && statuses[1] === 409, { a: a.status, b: b.status, ab: a.json, bb: b.json });
const conflict = a.status === 409 ? a : b;
check('409 envelope', conflict.json?.error?.code === 'conflict', conflict.json);

// the winner can cancel and the slot becomes free again
const winner = a.status === 201 ? a : b;
const winnerToken = a.status === 201 ? p1.access_token : p2.access_token;
const cancel = await call(`/appointments/${winner.json.id}`, { method: 'DELETE', token: winnerToken });
check('winner cancel 204', cancel.status === 204, cancel.status);
const freeAgain = await call(`/availability?professionalId=1&from=${slot.start.slice(0, 10)}&to=${slot.start.slice(0, 10)}`, { token: p1.access_token });
check('slot free again after cancel', freeAgain.json.some((s) => s.start === slot.start), freeAgain.json.length);

// EP-08 non-owner
const rebook = await call('/appointments', { method: 'POST', token: p1.access_token, body: { professionalId: 1, slotStart: slot.start } });
check('rebook 201', rebook.status === 201, rebook.json);
const notOwn = await call(`/appointments/${rebook.json.id}`, { method: 'DELETE', token: p2.access_token });
check('EP-08 not own 403', notOwn.status === 403, notOwn.json);
const missingCancel = await call('/appointments/999999', { method: 'DELETE', token: p1.access_token });
check('EP-08 missing 404', missingCancel.status === 404, missingCancel.json);
const staffCancel = await call(`/appointments/${rebook.json.id}`, { method: 'DELETE', token: (await login('staff@seed.local')).access_token });
check('EP-08 staff 403', staffCancel.status === 403, staffCancel.json);

console.log(out.join('\n'));
console.log(failures === 0 ? '\nCONCURRENCY PASSED' : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
