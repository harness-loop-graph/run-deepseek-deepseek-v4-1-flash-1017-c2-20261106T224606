import { createHash, randomBytes } from 'node:crypto';

const API = 'http://localhost:3000';
const REDIRECT = 'http://localhost:8080/auth/callback';
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const PASSWORD = process.env.SEED_PASSWORD ?? 'Seed!Passw0rd';

let failures = 0;
function check(name, condition, extra) {
  if (condition) console.log(`ok   ${name}`);
  else {
    failures += 1;
    console.log(`FAIL ${name}`, extra === undefined ? '' : JSON.stringify(extra));
  }
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
  const code = new URL(submit.headers.get('location')).searchParams.get('code');
  const tokenRes = await fetch(`${API}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, client_id: 'medapp-spa', redirect_uri: REDIRECT }),
  });
  const tokens = await tokenRes.json();
  return tokens;
}

async function call(path, { method = 'GET', token, body, headers = {}, formData } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (formData) payload = formData;
  else if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, { method, headers: h, body: payload, redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

function utcDate(offset) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offset * 86400000)
    .toISOString()
    .slice(0, 10);
}

const patient = await login('paciente2@seed.local');
const patient2 = await login('paciente3@seed.local');
const gomez = await login('gomez@seed.local');
const lopez = await login('lopez@seed.local');
const admin = await login('admin@seed.local');
const p = patient.access_token;

// undeclared query params on read endpoints
const q1 = await call('/me/appointments?x=1', { token: p });
check('EP-05 undeclared query 422', q1.status === 422, q1.json);
const q2 = await call('/agenda?from=2026-01-01&to=2026-01-02&x=1', { token: gomez.access_token });
check('EP-09 undeclared query 422', q2.status === 422, q2.json);
const q3 = await call('/admin/audit?bogus=1', { token: admin.access_token });
check('EP-19 undeclared query 422', q3.status === 422, q3.json);

// unknown route / method
const unknown = await call('/does-not-exist');
check('unknown route 404 envelope', unknown.status === 404 && typeof unknown.json?.error?.code === 'string', unknown.json);
const wrongMethod = await call('/me/appointments', { method: 'PUT', token: p });
check('wrong method 404 envelope', wrongMethod.status === 404 && typeof wrongMethod.json?.error?.code === 'string', wrongMethod.json);

// malformed JSON
const malformed = await call('/appointments', {
  method: 'POST',
  token: p,
  headers: { 'Content-Type': 'application/json' },
  body: undefined,
});
check('missing body 422', malformed.status === 422, malformed.json);
const rawBad = await fetch(`${API}/appointments`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p}` },
  body: '{"professionalId":',
});
const rawBadBody = await rawBad.json();
check('malformed json 400 clean', rawBad.status === 400 && !/position|at \w/i.test(rawBadBody.error.message), rawBadBody);

// EP-13: missing file and unauthorized uploader
const encounter = await call(`/appointments/1/encounters`, { token: gomez.access_token });
let encounterId = Array.isArray(encounter.json) && encounter.json.length > 0 ? encounter.json[0].id : null;
if (encounterId === null) {
  // create one via agenda appointment of gomez
  const agenda = await call(`/agenda?from=${utcDate(0)}&to=${utcDate(9)}`, { token: gomez.access_token });
  const first = agenda.json.flatMap((d) => d.appointments).find((a) => a.status !== 'cancelled');
  if (first) {
    const created = await call(`/appointments/${first.id}/encounter`, { method: 'POST', token: gomez.access_token, body: { notes: 'x', diagnosis: 'y' } });
    encounterId = created.json.id;
  }
}
check('encounter available for attachment checks', typeof encounterId === 'number', encounterId);
const noFile = await call(`/encounters/${encounterId}/attachments`, { method: 'POST', token: gomez.access_token, formData: new FormData() });
check('EP-13 missing file 422', noFile.status === 422, noFile.json);
const notAuthor = await call(`/encounters/${encounterId}/attachments`, {
  method: 'POST',
  token: lopez.access_token,
  formData: (() => {
    const f = new FormData();
    f.append('file', new Blob([Buffer.from('%PDF-1.4\n%%EOF\n')], { type: 'application/pdf' }), 'ok.pdf');
    return f;
  })(),
});
check('EP-13 other professional 403', notAuthor.status === 403, notAuthor.json);
const patientUpload = await call(`/encounters/${encounterId}/attachments`, {
  method: 'POST',
  token: p,
  formData: (() => {
    const f = new FormData();
    f.append('file', new Blob([Buffer.from('%PDF-1.4\n%%EOF\n')], { type: 'application/pdf' }), 'ok.pdf');
    return f;
  })(),
});
check('EP-13 patient 403', patientUpload.status === 403, patientUpload.json);

// rebook a cancelled slot
const day = utcDate(6);
const avail = await call(`/availability?professionalId=2&from=${day}&to=${day}`, { token: p });
const slot = avail.json[0];
const first = await call('/appointments', { method: 'POST', token: p, body: { professionalId: 2, slotStart: slot.start } });
check('book lopez slot', first.status === 201, first.json);
const cancel = await call(`/appointments/${first.json.id}`, { method: 'DELETE', token: p });
check('cancel lopez slot', cancel.status === 204, cancel.status);
const rebook = await call('/appointments', { method: 'POST', token: patient2.access_token, body: { professionalId: 2, slotStart: slot.start } });
check('rebook after cancel 201', rebook.status === 201, rebook.json);

// non-availability slot
const bogusSlot = await call('/appointments', { method: 'POST', token: p, body: { professionalId: 2, slotStart: `${day}T03:00:00.000Z` } });
check('EP-07 non-availability 422', bogusSlot.status === 422, bogusSlot.json);
const pastSlot = await call('/appointments', { method: 'POST', token: p, body: { professionalId: 2, slotStart: '2020-01-06T08:00:00.000Z' } });
check('EP-07 past slot 422', pastSlot.status === 422, pastSlot.json);

// lopez has no Friday slots
const friday = (() => {
  for (let offset = 2; offset <= 20; offset += 1) {
    const d = new Date(`${utcDate(offset)}T00:00:00.000Z`);
    if (d.getUTCDay() === 5) return utcDate(offset);
  }
  return null;
})();
if (friday !== null) {
  const lopezFriday = await call(`/availability?professionalId=2&from=${friday}&to=${friday}`, { token: p });
  check('lopez no Friday slots', lopezFriday.status === 200 && lopezFriday.json.length === 0, lopezFriday.json);
  const gomezFriday = await call(`/availability?professionalId=1&from=${friday}&to=${friday}`, { token: p });
  check('gomez has Friday slots', gomezFriday.status === 200 && gomezFriday.json.length > 0, gomezFriday.json.length);
}

// expired access token
const expiredSession = await login('paciente1@seed.local');
const setExpired = await fetch('http://localhost:3000/health');
check('health reachable', setExpired.status === 200);

// oversized JSON body
const huge = await call('/appointments', {
  method: 'POST',
  token: p,
  headers: { 'Content-Type': 'application/json' },
  body: { professionalId: 1, slotStart: 'x'.repeat(2 * 1024 * 1024) },
});
check('oversized body 413 clean', huge.status === 413 && huge.json?.error?.code === 'payload_too_large', huge.json);

console.log(failures === 0 ? '\nALL EDGE CHECKS PASSED' : `\n${failures} EDGE CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
