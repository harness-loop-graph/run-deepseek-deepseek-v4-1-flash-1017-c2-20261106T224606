# MedApp architecture

Outpatient appointment scheduling and clinical history registry. PostgreSQL 16
owns the schema (created only by versioned migrations), NestJS exposes the REST
API, and the React SPA is the only client. All three run under Docker Compose.

```
Browser (React SPA :8080)
   │  OAuth 2.0 authorization code + PKCE (S256)
   ├──────────────► NestJS API :3000 ──► PostgreSQL 16 :5432
   │  bearer access token (15 min)        schema + seed
   └──────────────► attachment stream (permission checked, storage outside web root)
```

## Entity model

Schema `public`, ids are `serial` (insertion order). Migrations live in
`backend/src/database/migrations` and each one declares `up` and `down`
(RF-02); the backend applies them on start and records them in
`schema_migrations`.

| Table | Purpose | Key columns / constraints |
| --- | --- | --- |
| `rol` | role catalogue | `nombre` unique, CHECK in `patient/professional/staff/admin` |
| `usuario` | account | `email` unique NOT NULL, `password_hash` (scrypt), `activo` |
| `usuario_rol` | account ↔ role | PK `(usuario_id, rol_id)`, FKs |
| `paciente` | patient profile | `usuario_id` unique FK, `nombre`, `apellidos`, `fecha_nacimiento`, `documento` unique |
| `profesional` | professional profile | `usuario_id` unique FK, `nombre`, `apellidos`, `especialidad` |
| `disponibilidad` | bookable slot window | FK `profesional_id`, `franja_inicio`, `franja_fin`, CHECK `fin > inicio`, unique `(profesional_id, franja_inicio)` |
| `cita` | appointment | FKs `paciente_id`, `profesional_id`; `franja_inicio`, `franja_fin`, `estado`, `cancelada_en`; CHECK `estado IN ('scheduled','attended','cancelled','no_show')`; partial unique index `(profesional_id, franja_inicio) WHERE estado <> 'cancelled'` |
| `encuentro` | clinical encounter (append-only) | FKs `cita_id`, `paciente_id`, `profesional_id`; `version`, `reemplaza_a` FK to `encuentro`, `notas`, `diagnostico`; CHECK `version > 0`, unique `(cita_id, version)`; trigger blocks UPDATE/DELETE |
| `adjunto` | attachment metadata (bytes on disk) | FK `encuentro_id`, `subido_por` FK `usuario`; `nombre_archivo`, `tipo_mime`, `tamano_bytes`, `ruta_almacenamiento`; CHECK `tamano_bytes > 0` |
| `auditoria` | append-only audit log | FK `usuario_id`; `accion`, `recurso_tipo`, `recurso_id`, `detalle` jsonb, `creado_en`; trigger blocks UPDATE/DELETE |
| `codigo_autorizacion` | one-time PKCE code | `codigo_hash` unique, `usuario_id` FK, `client_id`, `redirect_uri`, `code_challenge`, `usado`, `expira_en` |
| `sesion` | token session | `usuario_id` FK, `access_hash`/`refresh_hash` unique, both expiries, `revocada` |
| `token_acceso` | extra access tokens from a refresh | FK `sesion_id`, `token_hash` unique, `expira_en` |

Indexes (RF-04) cover every filtered or ordered column: `cita` by patient,
professional, slot start and state; `disponibilidad` by professional and slot
start; `encuentro` by appointment, patient and professional; `adjunto` by
encounter; `auditoria` by actor, action and timestamp; `sesion` and
`codigo_autorizacion` by their lookup keys.

Clinical data is append-only (RF-06): a correction inserts a new `encuentro`
with `version = previous + 1` and `reemplaza_a` pointing at the replaced row.

## Deterministic seed (RF-05)

| User | Role | Entity id |
| --- | --- | --- |
| `admin@seed.local` | admin | — |
| `staff@seed.local` | staff | — |
| `paciente1@seed.local` .. `paciente3@seed.local` | patient | patients 1..3 |
| `gomez@seed.local` | professional | professional 1 |
| `lopez@seed.local` | professional | professional 2 |

Password: `SEED_PASSWORD` (default `Seed!Passw0rd`). Availability: weekdays
08:00–16:00 in 30-minute slots for the 14 days after deployment; `lopez` has no
Friday slots. The seed is idempotent (`ON CONFLICT DO NOTHING`) and runs on
every backend start.

## Endpoint catalog

All errors use `{ "error": { "code", "message" } }` (RF-16). Every request
schema is strict: undeclared fields or query parameters are rejected with 422
(RF-12). `GET` bodies and unknown routes never leak internals.

| ID | Endpoint | Caller | Notes |
| --- | --- | --- | --- |
| EP-01 | `GET /auth/authorize` | any | validates client and redirect URI, 302 to the login form |
| EP-02 | `POST /auth/token` | any | code + `code_verifier`, 400 bad verifier, 401 used/expired code |
| EP-03 | `POST /auth/token/refresh` | any | rotates the refresh token, 401 expired/revoked |
| EP-04 | `POST /auth/revoke` | any | 204, revokes the whole session immediately |
| EP-05 | `GET /me/appointments` | patient | own appointments only |
| EP-06 | `GET /availability` | patient | free slots `{start,end}`, 422 invalid range |
| EP-07 | `POST /appointments` | patient | transactional booking, 409 taken, rate limited 10/min/user |
| EP-08 | `DELETE /appointments/:id` | patient (own) | 204, 403 not own, 404 unknown |
| EP-09 | `GET /agenda` | professional | grouped by day; staff sees the whole agenda |
| EP-10 | `GET /appointments/:id` | own patient / assigned professional / staff | 403, 404 |
| EP-11 | `POST /appointments/:id/encounter` | assigned professional | 201, new version when correcting |
| EP-12 | `GET /patients/:id/clinical-history` | self patient / assigned professional | chronology with attachments |
| EP-13 | `POST /encounters/:id/attachments` | authoring professional | PDF/JPEG/PNG, 5 MB, 413/415/422 |
| EP-14 | `GET /attachments/:id` | author or owning patient | streamed with `Content-Disposition` |
| EP-15 | `GET /admin/users` | admin | paginated |
| EP-16 | `POST /admin/users` | admin | 201, 409 exists |
| EP-17 | `PATCH /admin/users/:id/roles` | admin | 200, 422 unknown role |
| EP-18 | `PUT /admin/professionals/:id/availability` | admin | replaces the set, 422 overlap |
| EP-19 | `GET /admin/audit` | admin | `actor`, `action`, `from`, `to`, paginated |
| EP-20 | `GET /health` | any | `{ "status": "ok" }` |

Supporting read endpoints used by the SPA: `GET /professionals`,
`GET /appointments/:id/encounters`, `GET /professional/patients`,
`GET /admin/professionals`, `GET /admin/professionals/:id/availability`. They
carry the same guards, validation and audit rules.

## Authorization model

Guards run on every request (`AuthGuard`): bearer token → live session (not
revoked, not expired) → required role. Controllers then load the resource and
apply the ownership policy (`common/policies.ts`), so isolation is enforced in
the query path, never only in the UI (RF-09/RF-10).

| Role | May read | May write |
| --- | --- | --- |
| patient | own appointments, own clinical history, own attachments | book, cancel own appointment |
| professional | agenda, appointments assigned to them, history of patients with an assigned appointment, attachments they authored | record encounters, upload attachments |
| staff | scheduling data only (appointments, agenda, availability) | — (clinical content always denied) |
| admin | users, availability, audit log | create users, change roles, replace availability |

## Screens (RF-19) and endpoints

| Screen | Route | Role | Endpoints |
| --- | --- | --- | --- |
| SCR-01 login and authorization return | `/`, `/auth/callback` | anonymous | EP-01, EP-02 |
| SCR-02 patient portal | `/bookings` | patient | EP-05, EP-08, EP-10 |
| SCR-03 availability search and booking | `/search` | patient, staff | EP-06, EP-07, `GET /professionals` |
| SCR-04 professional agenda | `/agenda` | professional, staff | EP-09, EP-10 |
| SCR-05 appointment detail and encounter | `/appointments/:id` | patient, professional, staff | EP-10, EP-11, EP-13, EP-14 |
| SCR-06 clinical history | `/history`, `/history/:patientId` | patient, professional | EP-12, EP-14, `GET /professional/patients` |
| SCR-07 administration | `/admin` | admin | EP-15..EP-18, `GET /admin/professionals` |
| SCR-08 audit log | `/audit` | admin | EP-19 |

Navigation is filtered by role and every protected route redirects an
anonymous visitor to SCR-01 (RF-20). Each API-consuming view renders
`loading-indicator`, `error-banner` and `empty-state` (RF-24), and clinical
free text is rendered as text nodes, never as HTML (RF-22).

## Tokens and sessions

* Access token: 15 min, opaque random value stored hashed (`sha256`) in
  `sesion`/`token_acceso`. Refresh token: 8 h, stored hashed in `sesion`.
* Revocation marks the session revoked, which invalidates every token issued
  for it immediately (RF-08).
* The SPA keeps tokens in `sessionStorage`, refreshes proactively 60 s before
  expiry (single-flight) and calls EP-04 on logout (RF-23).

## Booking transaction (RF-13)

`POST /appointments` opens a transaction that locks the availability row
(`SELECT ... FOR UPDATE`), re-checks for an active booking of the same slot and
inserts. Two concurrent requests are serialised: one 201, the other 409. The
partial unique index on `(profesional_id, franja_inicio) WHERE estado <>
'cancelled'` is the database backstop and maps to the same 409.

## Audit (RF-15)

`AuditService.record` appends to `auditoria` for every write (booking,
cancellation, encounter, attachment upload, user create, role change,
availability replacement, token issue/revoke) and every clinical read
(clinical history, encounter list, attachment download, appointment detail).
The table rejects UPDATE and DELETE at the database level.

## Cross-cutting

* Rate limits (RF-14): auth endpoints 5 failed attempts/min/IP, booking
  10/min/user; both answer 429 with `Retry-After`.
* Attachments (RF-17): content-sniffed PDF/JPEG/PNG, 5 MB limit, sanitized
  filename, random stored name under `ATTACHMENTS_DIR` outside any web root,
  downloads only through EP-14.
* Configuration is environment-only (RF-26); see `.env.example`.
