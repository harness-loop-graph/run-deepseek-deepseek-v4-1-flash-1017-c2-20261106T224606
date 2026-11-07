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

async function call(path, { method = 'GET', token, body, headers = {}, formData } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (formData) payload = formData;
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${API}${path}`, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = text === '' ? null : JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text, headers: res.headers };
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

const admin = await login('admin@seed.local');
const staff = await login('staff@seed.local');
const p1 = await login('paciente1@seed.local');
const p2 = await login('paciente2@seed.local');
const g1 = await login('gomez@seed.local');
const l1 = await login('lopez@seed.local');

// EP-06 range limits
const tooLong = await call(`/availability?professionalId=1&from=${utcDate(1)}&to=${utcDate(90)}`, { token: p1.access_token });
check('EP-06 range > 60 days 422', tooLong.status === 422, tooLong.json);
const badDate = await call('/availability?professionalId=1&from=2026-02-30&to=2026-03-01', { token: p1.access_token });
check('EP-06 impossible date 422', badDate.status === 422, badDate.json);

// EP-16 duplicate email (case-insensitive) and role validation
const dup = await call('/admin/users', { method: 'POST', token: admin.access_token, body: { email: 'Paciente1@Seed.Local', roles: ['patient'] } });
check('EP-16 case-insensitive duplicate 409', dup.status === 409, dup.json);
const newUser = await call('/admin/users', { method: 'POST', token: admin.access_token, body: { email: `extra${Date.now()}@seed.local`, roles: ['staff', 'staff'] } });
check('EP-16 dedupes roles', newUser.status === 201 && newUser.json.roles.length === 1, newUser.json);
const rolesMissing = await call(`/admin/users/${newUser.json.id}/roles`, { method: 'PATCH', token: admin.access_token, body: { roles: ['nurse'] } });
check('EP-17 unknown role 422', rolesMissing.status === 422, rolesMissing.json);
const rolesEmpty = await call(`/admin/users/${newUser.json.id}/roles`, { method: 'PATCH', token: admin.access_token, body: { roles: [] } });
check('EP-17 empty roles 422', rolesEmpty.status === 422, rolesEmpty.json);
const rolesMissingUser = await call('/admin/users/999999/roles', { method: 'PATCH', token: admin.access_token, body: { roles: ['staff'] } });
check('EP-17 missing user 404', rolesMissingUser.status === 404, rolesMissingUser.json);

// EP-18 validations
const overlap = await call('/admin/professionals/1/availability', {
  method: 'PUT',
  token: admin.access_token,
  body: { slots: [
    { start: `${utcDate(1)}T08:00:00.000Z`, end: `${utcDate(1)}T09:00:00.000Z` },
    { start: `${utcDate(1)}T08:30:00.000Z`, end: `${utcDate(1)}T10:00:00.000Z` },
  ] },
});
check('EP-18 overlap 422', overlap.status === 422, overlap.json);
const reversed = await call('/admin/professionals/1/availability', {
  method: 'PUT',
  token: admin.access_token,
  body: { slots: [{ start: `${utcDate(1)}T10:00:00.000Z`, end: `${utcDate(1)}T09:00:00.000Z` }] },
});
check('EP-18 reversed 422', reversed.status === 422, reversed.json);
const unknownProf = await call('/admin/professionals/999/availability', { method: 'PUT', token: admin.access_token, body: { slots: [] } });
check('EP-18 unknown professional 404', unknownProf.status === 404, unknownProf.json);
const undeclared = await call('/admin/professionals/1/availability', { method: 'PUT', token: admin.access_token, body: { slots: [], extra: true } });
check('EP-18 undeclared field 422', undeclared.status === 422, undeclared.json);
const getAvail = await call('/admin/professionals/1/availability', { token: admin.access_token });
check('EP-18 read availability 200', getAvail.status === 200 && Array.isArray(getAvail.json), getAvail.json);

// EP-19 date filters + paging
const today = utcDate(0);
const auditFrom = await call(`/admin/audit?from=${today}&to=${today}`, { token: admin.access_token });
check('EP-19 date filter 200', auditFrom.status === 200 && Array.isArray(auditFrom.json.items), auditFrom.json);
const auditBadDate = await call('/admin/audit?from=not-a-date', { token: admin.access_token });
check('EP-19 bad date 422', auditBadDate.status === 422, auditBadDate.json);
const auditPage = await call('/admin/audit?page=2&pageSize=2', { token: admin.access_token });
check('EP-19 paging', auditPage.status === 200 && auditPage.json.page === 2 && auditPage.json.items.length <= 2, auditPage.json);

// EP-10 staff can read scheduling data, admin cannot
const mine = await call('/me/appointments', { token: p1.access_token });
if (mine.json.length > 0) {
  const id = mine.json[0].id;
  const staffRead = await call(`/appointments/${id}`, { token: staff.access_token });
  check('EP-10 staff 200', staffRead.status === 200, staffRead.json);
  const adminRead = await call(`/appointments/${id}`, { token: admin.access_token });
  check('EP-10 admin 403', adminRead.status === 403, adminRead.json);
  const gomezRead = await call(`/appointments/${id}`, { token: g1.access_token });
  check('EP-10 assigned professional 200', gomezRead.status === 200, gomezRead.json);
  const lopezRead = await call(`/appointments/${id}`, { token: l1.access_token });
  check('EP-10 other professional 403', lopezRead.status === 403, lopezRead.json);
}

// EP-11 validation
const badNotes = await call(`/appointments/1/encounter`, { method: 'POST', token: g1.access_token, body: { notes: '', diagnosis: 'x' } });
check('EP-11 empty notes 422', badNotes.status === 422, badNotes.json);
const extraField = await call(`/appointments/1/encounter`, { method: 'POST', token: g1.access_token, body: { notes: 'a', diagnosis: 'b', version: 3 } });
check('EP-11 undeclared field 422', extraField.status === 422, extraField.json);
const patientEncounter = await call(`/appointments/1/encounter`, { method: 'POST', token: p1.access_token, body: { notes: 'a', diagnosis: 'b' } });
check('EP-11 patient 403', patientEncounter.status === 403, patientEncounter.json);

// EP-12 admin denied, patient self ok
const adminHistory = await call('/patients/1/clinical-history', { token: admin.access_token });
check('EP-12 admin 403', adminHistory.status === 403, adminHistory.json);
const selfHistory = await call('/patients/1/clinical-history', { token: p1.access_token });
check('EP-12 self 200', selfHistory.status === 200 && selfHistory.json.patientId === 1, selfHistory.json);
const missingPatient = await call('/patients/999/clinical-history', { token: p1.access_token });
check('EP-12 unknown patient 404', missingPatient.status === 404, missingPatient.json);

// EP-13 wrong field name / wrong type
const enc = await call(`/appointments/${mine.json[0].id}/encounters`, { token: g1.access_token });
const encounterId = enc.json[0]?.id;
if (encounterId !== undefined) {
  const wrongField = new FormData();
  wrongField.append('document', new Blob([Buffer.from('%PDF-1.4\n%%EOF\n')], { type: 'application/pdf' }), 'a.pdf');
  const res = await call(`/encounters/${encounterId}/attachments`, { method: 'POST', token: g1.access_token, formData: wrongField });
  check('EP-13 wrong field 422', res.status === 422, res.json);
  const png = new FormData();
  png.append('file', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])], { type: 'image/png' }), 'x.png');
  const pngRes = await call(`/encounters/${encounterId}/attachments`, { method: 'POST', token: g1.access_token, formData: png });
  check('EP-13 png 201', pngRes.status === 201 && pngRes.json.mimeType === 'image/png', pngRes.json);
  const spoofed = new FormData();
  spoofed.append('file', new Blob([Buffer.from('<html><script>alert(1)</script></html>')], { type: 'application/pdf' }), 'evil.pdf');
  const spoofRes = await call(`/encounters/${encounterId}/attachments`, { method: 'POST', token: g1.access_token, formData: spoofed });
  check('EP-13 content sniff rejects spoof 415', spoofRes.status === 415, spoofRes.json);
  const traversal = new FormData();
  traversal.append('file', new Blob([Buffer.from('%PDF-1.4\n%%EOF\n')], { type: 'application/pdf' }), '../../etc/passwd.pdf');
  const travRes = await call(`/encounters/${encounterId}/attachments`, { method: 'POST', token: g1.access_token, formData: traversal });
  check('EP-13 filename sanitized', travRes.status === 201 && !travRes.json.filename.includes('/') && !travRes.json.filename.includes('..'), travRes.json);
  const download = await call(`/attachments/${travRes.json.id}`, { token: p1.access_token });
  check('EP-14 download headers', download.status === 200 && download.headers.get('content-type') === 'application/pdf' && download.headers.get('x-content-type-options') === 'nosniff', download.headers.get('content-type'));
  const patientUpload = await call(`/encounters/${encounterId}/attachments`, { method: 'POST', token: p1.access_token, formData: png });
  check('EP-13 patient 403', patientUpload.status === 403, patientUpload.json);
  const otherPro = await call(`/encounters/${encounterId}/attachments`, { method: 'POST', token: l1.access_token, formData: png });
  check('EP-13 unassigned professional 403', otherPro.status === 403, otherPro.json);
}

// EP-14 unknown + wrong role
const noAttachment = await call('/attachments/999999', { token: p1.access_token });
check('EP-14 missing 404', noAttachment.status === 404, noAttachment.json);
const staffAttachment = await call('/attachments/1', { token: staff.access_token });
check('EP-14 staff 403', staffAttachment.status === 403, staffAttachment.json);

// EP-01 validation
const badClient = await call('/auth/authorize?response_type=code&client_id=other&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fauth%2Fcallback&code_challenge=' + 'a'.repeat(43) + '&code_challenge_method=S256&state=x', {});
check('EP-01 unknown client 400', badClient.status === 400, badClient.json);
const badRedirect = await call('/auth/authorize?response_type=code&client_id=medapp-spa&redirect_uri=http%3A%2F%2Fevil.test%2Fcb&code_challenge=' + 'a'.repeat(43) + '&code_challenge_method=S256&state=x', {});
check('EP-01 unregistered redirect 400', badRedirect.status === 400, badRedirect.json);
const badMethod = await call('/auth/authorize?response_type=code&client_id=medapp-spa&redirect_uri=' + encodeURIComponent(REDIRECT) + '&code_challenge=' + 'a'.repeat(43) + '&code_challenge_method=plain&state=x', {});
check('EP-01 non-S256 422', badMethod.status === 422, badMethod.json);
const badType = await call('/auth/authorize?response_type=token&client_id=medapp-spa&redirect_uri=' + encodeURIComponent(REDIRECT) + '&code_challenge=' + 'a'.repeat(43) + '&code_challenge_method=S256&state=x', {});
check('EP-01 implicit flow rejected', badType.status === 422, badType.json);

// EP-02 code reuse
const verifier = b64url(randomBytes(48));
const challenge = b64url(createHash('sha256').update(verifier).digest());
const state = b64url(randomBytes(16));
const submit = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: 'medapp-spa', redirect_uri: REDIRECT, code_challenge: challenge, state, email: 'paciente3@seed.local', password: PASSWORD }),
  redirect: 'manual',
});
const code = new URL(submit.headers.get('location')).searchParams.get('code');
const body = { code, code_verifier: verifier, client_id: 'medapp-spa', redirect_uri: REDIRECT };
const first = await call('/auth/token', { method: 'POST', body });
const second = await call('/auth/token', { method: 'POST', body });
check('EP-02 code single use', first.status === 200 && second.status === 401, { first: first.status, second: second.status });
const wrongClient = await call('/auth/token', { method: 'POST', body: { ...body, client_id: 'other' } });
check('EP-02 wrong client 400/401', [400, 401].includes(wrongClient.status), wrongClient.json);

console.log(out.join('\n'));
console.log(failures === 0 ? '\nEDGE PASSED' : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
