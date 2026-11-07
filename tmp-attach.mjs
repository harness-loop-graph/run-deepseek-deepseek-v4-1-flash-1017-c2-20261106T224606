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
  return tokenRes.json();
}

async function call(path, { method = 'GET', token, body, formData } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (formData) payload = formData;
  else if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, { method, headers: h, body: payload });
  const buffer = Buffer.from(await res.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buffer.toString('utf8'));
  } catch {
    json = null;
  }
  return { status: res.status, json, buffer, headers: res.headers };
}

function pdf(size = 100) {
  const head = Buffer.from('%PDF-1.4\n');
  const tail = Buffer.from('\n%%EOF\n');
  return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length - tail.length), 0x20), tail]);
}

const patient1 = await login('paciente1@seed.local');
const patient2 = await login('paciente2@seed.local');
const gomez = await login('gomez@seed.local');
const lopez = await login('lopez@seed.local');

// Book a slot for patient1 with gomez so the professional is assigned.
const day = new Date();
const dayIso = (offset) =>
  new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) + offset * 86400000)
    .toISOString()
    .slice(0, 10);
let booked = null;
for (let offset = 2; offset <= 10 && booked === null; offset += 1) {
  const date = dayIso(offset);
  const availability = await call(`/availability?professionalId=1&from=${date}&to=${date}`, {
    token: patient1.access_token,
  });
  if (Array.isArray(availability.json) && availability.json.length > 0) {
    const created = await call('/appointments', {
      method: 'POST',
      token: patient1.access_token,
      body: { professionalId: 1, slotStart: availability.json[0].start },
    });
    if (created.status === 201) booked = created.json;
  }
}
check('booked an appointment for attachments', booked !== null);

const encounter = await call(`/appointments/${booked.id}/encounter`, {
  method: 'POST',
  token: gomez.access_token,
  body: { notes: 'Nota para adjunto', diagnosis: 'Diagnóstico adjunto' },
});
check('EP-11 201 encounter', encounter.status === 201, encounter.json);
const encounterId = encounter.json.id;

const form = (buffer, name, type) => {
  const f = new FormData();
  f.append('file', new Blob([buffer], { type }), name);
  return f;
};

const uploaded = await call(`/encounters/${encounterId}/attachments`, {
  method: 'POST',
  token: gomez.access_token,
  formData: form(pdf(2048), '../../etc/pa sswd.pdf', 'application/pdf'),
});
check('EP-13 201 pdf', uploaded.status === 201, uploaded.json);
check('EP-13 filename sanitized', uploaded.json?.filename === 'pa_sswd.pdf', uploaded.json?.filename);
check('EP-13 mime detected', uploaded.json?.mimeType === 'application/pdf');

const tooBig = await call(`/encounters/${encounterId}/attachments`, {
  method: 'POST',
  token: gomez.access_token,
  formData: form(pdf(6 * 1024 * 1024), 'big.pdf', 'application/pdf'),
});
check('EP-13 413 too large', tooBig.status === 413, tooBig.status);

const wrongType = await call(`/encounters/${encounterId}/attachments`, {
  method: 'POST',
  token: gomez.access_token,
  formData: form(Buffer.from('plain text, not allowed'), 'note.txt', 'text/plain'),
});
check('EP-13 415 wrong type', wrongType.status === 415, wrongType.status);

const empty = await call(`/encounters/${encounterId}/attachments`, {
  method: 'POST',
  token: gomez.access_token,
  formData: form(Buffer.alloc(0), 'empty.pdf', 'application/pdf'),
});
check('EP-13 422 empty', empty.status === 422, empty.status);

const download = await call(`/attachments/${uploaded.json.id}`, { token: patient1.access_token });
check('EP-14 patient 200', download.status === 200, download.status);
check('EP-14 content-type pdf', download.headers.get('content-type') === 'application/pdf');
check('EP-14 content length', download.buffer.length === 2048, download.buffer.length);
check('EP-14 disposition attachment', (download.headers.get('content-disposition') ?? '').startsWith('attachment;'));

const otherPatient = await call(`/attachments/${uploaded.json.id}`, { token: patient2.access_token });
check('EP-14 other patient 403', otherPatient.status === 403, otherPatient.status);
const otherProfessional = await call(`/attachments/${uploaded.json.id}`, { token: lopez.access_token });
check('EP-14 other professional 403', otherProfessional.status === 403, otherProfessional.status);

const history = await call(`/patients/1/clinical-history`, { token: patient1.access_token });
check('EP-12 history 200', history.status === 200, history.status);
const entry = history.json.encounters.find((item) => item.id === encounterId);
check('EP-12 attachment listed', entry?.attachments?.some((a) => a.id === uploaded.json.id) === true);

// A second encounter for the same appointment must be a new version (RF-06).
const correction = await call(`/appointments/${booked.id}/encounter`, {
  method: 'POST',
  token: gomez.access_token,
  body: { notes: 'Corrección', diagnosis: 'Diagnóstico corregido' },
});
check('RF-06 correction version 2', correction.status === 201 && correction.json.version === 2, correction.json?.version);
check('RF-06 correction references previous', correction.json?.replaces === encounterId, correction.json?.replaces);

const admin = await login('admin@seed.local');
const audit = await call('/admin/audit?action=attachment_uploaded', { token: admin.access_token });
check('RF-15 attachment upload audited', audit.status === 200 && audit.json.items.length >= 1, audit.json?.total);
const auditDownload = await call('/admin/audit?action=attachment_read', { token: admin.access_token });
check('RF-15 attachment read audited', auditDownload.status === 200 && auditDownload.json.items.length >= 1);

console.log(failures === 0 ? '\nATTACHMENTS PASSED' : `\n${failures} ATTACHMENT FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
