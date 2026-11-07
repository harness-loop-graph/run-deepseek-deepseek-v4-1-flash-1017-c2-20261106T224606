import { createHash, randomBytes } from 'node:crypto';

const API = 'http://localhost:3000';
const REDIRECT = 'http://localhost:8080/auth/callback';
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const PASSWORD = process.env.SEED_PASSWORD ?? 'Seed!Passw0rd';

let failures = 0;
function check(name, condition, extra) {
  if (condition) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

async function login(email) {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));
  const authz = await fetch(
    `${API}/auth/authorize?response_type=code&client_id=medapp-spa&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`,
    { redirect: 'manual' },
  );
  check(`EP-01 302 for ${email}`, authz.status === 302, authz.status);
  const formRes = await fetch(authz.headers.get('location'));
  const html = await formRes.text();
  check(
    `EP-01 login form fields for ${email}`,
    ['name="email"', 'name="password"', 'type="submit"', 'method="post"'].every((t) => html.includes(t)),
  );
  const body = new URLSearchParams({
    client_id: 'medapp-spa',
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    state,
    email,
    password: PASSWORD,
  });
  const submit = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'manual',
  });
  const location = submit.headers.get('location') ?? '';
  check(`EP-01 form submit 302 for ${email}`, submit.status === 302, submit.status);
  const redirect = new URL(location);
  const code = redirect.searchParams.get('code');
  check(`EP-01 code+state for ${email}`, code !== null && redirect.searchParams.get('state') === state);
  const tokenRes = await fetch(`${API}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, client_id: 'medapp-spa', redirect_uri: REDIRECT }),
  });
  const tokens = await tokenRes.json();
  check(
    `EP-02 tokens for ${email}`,
    tokenRes.status === 200 && typeof tokens.access_token === 'string' && typeof tokens.refresh_token === 'string',
    { status: tokenRes.status, tokens },
  );
  return { tokens, verifier, code, state, challenge };
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
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offset * 86400000);
  return day.toISOString().slice(0, 10);
}

function bookingDay() {
  for (let offset = 2; offset <= 9; offset += 1) {
    const day = new Date(`${utcDate(offset)}T00:00:00.000Z`).getUTCDay();
    if (day !== 0 && day !== 6) return utcDate(offset);
  }
  return utcDate(2);
}

const health = await call('/health');
check('EP-20 health', health.status === 200 && health.json?.status === 'ok', health);

const patient1 = await login('paciente1@seed.local');
const patient2 = await login('paciente2@seed.local');
const gomez = await login('gomez@seed.local');
const lopez = await login('lopez@seed.local');
const staff = await login('staff@seed.local');
const admin = await login('admin@seed.local');

const p1 = patient1.tokens.access_token;
const p2 = patient2.tokens.access_token;
const g1 = gomez.tokens.access_token;
const l1 = lopez.tokens.access_token;
const s1 = staff.tokens.access_token;
const a1 = admin.tokens.access_token;

check('token user ids', patient1.tokens.user.id === 3 && patient2.tokens.user.id === 4, patient1.tokens.user);
check('patient ids 1..3', patient1.tokens.user.patientId === 1 && patient2.tokens.user.patientId === 2, patient1.tokens.user);
check('professional ids', gomez.tokens.user.professionalId === 1 && lopez.tokens.user.professionalId === 2, gomez.tokens.user);

// --- availability
const day = bookingDay();
const avail = await call(`/availability?professionalId=1&from=${day}&to=${day}`, { token: p1 });
check('EP-06 slots array {start,end}', avail.status === 200 && Array.isArray(avail.json) && typeof avail.json[0]?.start === 'string' && typeof avail.json[0]?.end === 'string', avail.json);
const badRange = await call(`/availability?professionalId=1&from=${day}&to=${utcDate(1)}`, { token: p1 });
check('EP-06 invalid range 422', badRange.status === 422, badRange.json);
const extraQuery = await call(`/availability?professionalId=1&from=${day}&to=${day}&evil=1`, { token: p1 });
check('EP-06 undeclared field 422', extraQuery.status === 422, extraQuery.json);

// --- booking
const slot = avail.json[0];
const booked = await call('/appointments', { method: 'POST', token: p2, body: { professionalId: 1, slotStart: slot.start } });
check('EP-07 201 with id', booked.status === 201 && typeof booked.json?.id === 'number', booked.json);
const appointmentId = booked.json?.id;
const dup = await call('/appointments', { method: 'POST', token: p1, body: { professionalId: 1, slotStart: slot.start } });
check('EP-07 duplicate slot 409', dup.status === 409, dup.json);
const undeclared = await call('/appointments', { method: 'POST', token: p1, body: { professionalId: 1, slotStart: slot.start, extra: 1 } });
check('EP-07 undeclared field 422', undeclared.status === 422, undeclared.json);

// concurrent bookings on a second slot
const slot2 = avail.json[1];
const concurrent = await Promise.all([
  call('/appointments', { method: 'POST', token: p1, body: { professionalId: 1, slotStart: slot2.start } }),
  call('/appointments', { method: 'POST', token: p2, body: { professionalId: 1, slotStart: slot2.start } }),
]);
const statuses = concurrent.map((r) => r.status).sort();
check('RF-13 concurrent booking 201+409', statuses[0] === 201 && statuses[1] === 409, statuses);

// --- patient isolation
const mine = await call('/me/appointments', { token: p2 });
check('EP-05 own appointments', mine.status === 200 && mine.json.every((a) => a.patientId === 2), mine.json);
const otherDetail = await call(`/appointments/${appointmentId}`, { token: p1 });
check('EP-10 other patient 403', otherDetail.status === 403, otherDetail.json);
const ownDetail = await call(`/appointments/${appointmentId}`, { token: p2 });
check('EP-10 own 200', ownDetail.status === 200 && ownDetail.json.id === appointmentId, ownDetail.json);
const missing = await call('/appointments/999999', { token: p2 });
check('EP-10 missing 404', missing.status === 404, missing.json);
const staffDetail = await call(`/appointments/${appointmentId}`, { token: s1 });
check('EP-10 staff scheduling 200', staffDetail.status === 200, staffDetail.json);
const unassignedPro = await call(`/appointments/${appointmentId}`, { token: l1 });
check('EP-10 unassigned professional 403', unassignedPro.status === 403, unassignedPro.json);

// --- agenda
const agenda = await call('/agenda', { token: g1 });
check('EP-09 grouped by day', agenda.status === 200 && Array.isArray(agenda.json) && agenda.json.every((d) => typeof d.date === 'string' && Array.isArray(d.appointments)), agenda.json);
const agendaRange = await call(`/agenda?from=${day}&to=${day}`, { token: g1 });
check('EP-09 range contains booked', agendaRange.status === 200 && agendaRange.json.some((d) => d.appointments.some((a) => a.id === appointmentId)), agendaRange.json);
const staffAgenda = await call(`/agenda?from=${day}&to=${day}`, { token: s1 });
check('EP-09 staff 200', staffAgenda.status === 200, staffAgenda.json);
const patientAgenda = await call('/agenda', { token: p1 });
check('EP-09 patient 403', patientAgenda.status === 403, patientAgenda.json);

// --- encounter
const unassignedEncounter = await call(`/appointments/${appointmentId}/encounter`, { method: 'POST', token: l1, body: { notes: 'x', diagnosis: 'y' } });
check('EP-11 unassigned 403', unassignedEncounter.status === 403, unassignedEncounter.json);
const encounter = await call(`/appointments/${appointmentId}/encounter`, { method: 'POST', token: g1, body: { notes: 'Dolor lumbar', diagnosis: 'Lumbalgia' } });
check('EP-11 201 encounter', encounter.status === 201 && encounter.json?.version === 1, encounter.json);
const corrected = await call(`/appointments/${appointmentId}/encounter`, { method: 'POST', token: g1, body: { notes: 'Dolor lumbar irradiado', diagnosis: 'Lumbalgia mecánica' } });
check('RF-06 correction version 2', corrected.status === 201 && corrected.json?.version === 2 && corrected.json?.replaces === encounter.json?.id, corrected.json);
const encounterMissing = await call('/appointments/999999/encounter', { method: 'POST', token: g1, body: { notes: 'x', diagnosis: 'y' } });
check('EP-11 missing 404', encounterMissing.status === 404, encounterMissing.json);

// --- clinical history
const history = await call('/patients/2/clinical-history', { token: p2 });
check('EP-12 own history 200', history.status === 200 && history.json.encounters.some((e) => e.notes === 'Dolor lumbar irradiado'), history.json);
const historyOther = await call('/patients/1/clinical-history', { token: p2 });
check('EP-12 other patient 403', historyOther.status === 403, historyOther.json);
const historyAssigned = await call('/patients/2/clinical-history', { token: g1 });
check('EP-12 assigned professional 200', historyAssigned.status === 200, historyAssigned.json);
const historyUnassigned = await call('/patients/3/clinical-history', { token: l1 });
check('EP-12 unassigned professional 403', historyUnassigned.status === 403, historyUnassigned.json);
const historyStaff = await call('/patients/2/clinical-history', { token: s1 });
check('EP-12 staff 403', historyStaff.status === 403, historyStaff.json);
const historyAdmin = await call('/patients/2/clinical-history', { token: a1 });
check('EP-12 admin 403', historyAdmin.status === 403, historyAdmin.json);

// --- attachments
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const form = new FormData();
form.append('file', new Blob([pdf], { type: 'application/pdf' }), '../evil name.pdf');
const upload = await call(`/encounters/${encounter.json.id}/attachments`, { method: 'POST', token: g1, formData: form });
check('EP-13 201 upload', upload.status === 201 && typeof upload.json?.id === 'number', upload.json);
check('EP-13 filename sanitized', upload.json?.filename === 'evil_name.pdf', upload.json?.filename);
const attachmentId = upload.json?.id;
const badForm = new FormData();
badForm.append('file', new Blob([Buffer.from('hello')], { type: 'text/plain' }), 'a.txt');
const badType = await call(`/encounters/${encounter.json.id}/attachments`, { method: 'POST', token: g1, formData: badForm });
check('EP-13 415 bad type', badType.status === 415, badType.json);
const bigForm = new FormData();
bigForm.append('file', new Blob([Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5 * 1024 * 1024 + 10, 0x20)])], { type: 'application/pdf' }), 'big.pdf');
const tooBig = await call(`/encounters/${encounter.json.id}/attachments`, { method: 'POST', token: g1, formData: bigForm });
check('EP-13 413 too large', tooBig.status === 413, tooBig.json);
const download = await call(`/attachments/${attachmentId}`, { token: p2 });
check('EP-14 patient download 200', download.status === 200 && download.text.startsWith('%PDF-'), download.status);
const downloadPro = await call(`/attachments/${attachmentId}`, { token: g1 });
check('EP-14 author download 200', downloadPro.status === 200, downloadPro.status);
const downloadOther = await call(`/attachments/${attachmentId}`, { token: p1 });
check('EP-14 other patient 403', downloadOther.status === 403, downloadOther.json);
const downloadStaff = await call(`/attachments/${attachmentId}`, { token: s1 });
check('EP-14 staff 403', downloadStaff.status === 403, downloadStaff.json);
const downloadMissing = await call('/attachments/999999', { token: p1 });
check('EP-14 missing 404', downloadMissing.status === 404, downloadMissing.json);

// --- cancel
const cancelOther = await call(`/appointments/${appointmentId}`, { method: 'DELETE', token: p1 });
check('EP-08 not own 403', cancelOther.status === 403, cancelOther.json);
const cancelOwn = await call(`/appointments/${appointmentId}`, { method: 'DELETE', token: p2 });
check('EP-08 own 204', cancelOwn.status === 204, cancelOwn.status);
const cancelAgain = await call(`/appointments/${appointmentId}`, { method: 'DELETE', token: p2 });
check('EP-08 repeat idempotent 204', cancelAgain.status === 204, cancelAgain.status);
const cancelMissing = await call('/appointments/999999', { method: 'DELETE', token: p2 });
check('EP-08 missing 404', cancelMissing.status === 404, cancelMissing.json);

// --- admin
const users = await call('/admin/users?page=1', { token: a1 });
check('EP-15 paginated', users.status === 200 && Array.isArray(users.json?.items) && users.json.total >= 7, users.json);
const usersForbidden = await call('/admin/users', { token: p1 });
check('EP-15 patient 403', usersForbidden.status === 403, usersForbidden.json);
const newUser = await call('/admin/users', { method: 'POST', token: a1, body: { email: `tmp-${Date.now()}@seed.local`, roles: ['staff'] } });
check('EP-16 201', newUser.status === 201 && newUser.json?.roles?.[0] === 'staff', newUser.json);
const dupUser = await call('/admin/users', { method: 'POST', token: a1, body: { email: 'admin@seed.local', roles: ['admin'] } });
check('EP-16 exists 409', dupUser.status === 409, dupUser.json);
const badRole = await call('/admin/users', { method: 'POST', token: a1, body: { email: `tmp2-${Date.now()}@seed.local`, roles: ['wizard'] } });
check('EP-16 unknown role 422', badRole.status === 422, badRole.json);
const patched = await call(`/admin/users/${newUser.json.id}/roles`, { method: 'PATCH', token: a1, body: { roles: ['patient', 'staff'] } });
check('EP-17 200 roles', patched.status === 200 && patched.json.roles.length === 2, patched.json);
const patchBad = await call(`/admin/users/${newUser.json.id}/roles`, { method: 'PATCH', token: a1, body: { roles: ['nope'] } });
check('EP-17 unknown role 422', patchBad.status === 422, patchBad.json);

const availability = await call('/admin/professionals/1/availability', { token: a1 });
check('availability read', availability.status === 200 && Array.isArray(availability.json), availability.status);
const slots = [
  { start: `${utcDate(3)}T08:00:00.000Z`, end: `${utcDate(3)}T08:30:00.000Z` },
  { start: `${utcDate(3)}T08:30:00.000Z`, end: `${utcDate(3)}T09:00:00.000Z` },
];
const replaced = await call('/admin/professionals/2/availability', { method: 'PUT', token: a1, body: { slots } });
check('EP-18 replace 200', replaced.status === 200 && replaced.json.slots.length === 2, replaced.json);
const overlap = await call('/admin/professionals/2/availability', {
  method: 'PUT',
  token: a1,
  body: { slots: [slots[0], { start: `${utcDate(3)}T08:15:00.000Z`, end: `${utcDate(3)}T08:45:00.000Z` }] },
});
check('EP-18 overlap 422', overlap.status === 422, overlap.json);
const adminForbidden = await call('/admin/professionals/2/availability', { method: 'PUT', token: g1, body: { slots } });
check('EP-18 non-admin 403', adminForbidden.status === 403, adminForbidden.json);

const audit = await call('/admin/audit?page=1', { token: a1 });
check('EP-19 paginated', audit.status === 200 && Array.isArray(audit.json?.items) && audit.json.items.length > 0, audit.json?.total);
check('RF-15 audit records actions', audit.json.items.some((i) => i.action === 'appointment_created') && audit.json.items.some((i) => i.action === 'clinical_history_read'), audit.json.items.slice(0, 3));
const auditFiltered = await call('/admin/audit?action=appointment_created', { token: a1 });
check('EP-19 action filter', auditFiltered.status === 200 && auditFiltered.json.items.every((i) => i.action === 'appointment_created'), auditFiltered.json.items.length);
const auditActor = await call('/admin/audit?actor=gomez@seed.local', { token: a1 });
check('EP-19 actor filter', auditActor.status === 200 && auditActor.json.items.every((i) => i.actorEmail === 'gomez@seed.local'), auditActor.json.items.length);
const auditForbidden = await call('/admin/audit', { token: s1 });
check('EP-19 staff 403', auditForbidden.status === 403, auditForbidden.json);

// --- tokens
const refreshed = await call('/auth/token/refresh', { method: 'POST', body: { refresh_token: patient2.tokens.refresh_token } });
check('EP-03 refresh 200', refreshed.status === 200 && typeof refreshed.json?.access_token === 'string', refreshed.status);
const oldRefresh = await call('/auth/token/refresh', { method: 'POST', body: { refresh_token: patient2.tokens.refresh_token } });
check('EP-03 rotated refresh rejected 401', oldRefresh.status === 401, oldRefresh.json);
const revoked = await call('/auth/revoke', { method: 'POST', body: { token: refreshed.json.refresh_token } });
check('EP-04 revoke 204', revoked.status === 204, revoked.status);
const afterRevoke = await call('/me/appointments', { token: refreshed.json.access_token });
check('RF-08 revoked access unusable 401', afterRevoke.status === 401, afterRevoke.json);
const refreshRevoked = await call('/auth/token/refresh', { method: 'POST', body: { refresh_token: refreshed.json.refresh_token } });
check('RF-08 revoked refresh 401', refreshRevoked.status === 401, refreshRevoked.json);
const unknownRevoke = await call('/auth/revoke', { method: 'POST', body: { token: 'not-a-token' } });
check('EP-04 unknown 401', unknownRevoke.status === 401, unknownRevoke.json);

// --- token exchange errors
async function freshCode(email) {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));
  const body = new URLSearchParams({
    client_id: 'medapp-spa',
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    state,
    email,
    password: PASSWORD,
  });
  const submit = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'manual',
  });
  return new URL(submit.headers.get('location')).searchParams.get('code');
}
const fresh = await freshCode('paciente3@seed.local');
const badVerifier = await fetch(`${API}/auth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    code: fresh,
    code_verifier: b64url(randomBytes(48)),
    client_id: 'medapp-spa',
    redirect_uri: REDIRECT,
  }),
});
const badVerifierBody = await badVerifier.json();
check('EP-02 bad verifier 400', badVerifier.status === 400 && typeof badVerifierBody.error?.code === 'string', badVerifierBody);

// --- errors never leak internals
const unauthorizedCall = await call('/me/appointments');
check('401 envelope', unauthorizedCall.status === 401 && typeof unauthorizedCall.json?.error?.message === 'string', unauthorizedCall.json);
const notFoundRoute = await call('/nope');
const leak = /at \w|SELECT |\/home\/|node_modules|Error:/.test(notFoundRoute.text + JSON.stringify(unauthorizedCall.json));
check('RF-16 no internals in errors', !leak, notFoundRoute.text);

// --- rate limiting (booking 10/min per user)
const rlUser = await login('paciente3@seed.local');
const rlDay = utcDate(9);
const rlAvail = await call(`/availability?professionalId=1&from=${rlDay}&to=${rlDay}`, { token: rlUser.tokens.access_token });
let limited = null;
for (let i = 0; i < 14; i += 1) {
  const res = await call('/appointments', {
    method: 'POST',
    token: rlUser.tokens.access_token,
    body: { professionalId: 1, slotStart: rlAvail.json[0].start },
  });
  if (res.status === 429) {
    limited = res;
    break;
  }
}
check('RF-14 booking 429 with Retry-After', limited !== null && limited.headers.get('retry-after') !== null, limited?.status);

// auth rate limit: repeated bad logins
let authLimited = null;
for (let i = 0; i < 8; i += 1) {
  const res = await call('/auth/token', { method: 'POST', body: { code: 'x', code_verifier: 'a'.repeat(43), client_id: 'medapp-spa', redirect_uri: REDIRECT } });
  if (res.status === 429) {
    authLimited = res;
    break;
  }
}
check('RF-14 auth 429 with Retry-After', authLimited !== null && authLimited.headers.get('retry-after') !== null, authLimited?.status);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
