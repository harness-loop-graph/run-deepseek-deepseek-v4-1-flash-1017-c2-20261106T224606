# MedApp — Medical appointments and clinical history

Outpatient appointment scheduling and clinical history registry with four
roles (patient, healthcare professional, administrative staff, system
administrator).

Fixed stack: PostgreSQL 16 (schema created only by versioned migrations),
NestJS REST backend, React single-page application, Vitest unit tests and
Playwright end-to-end tests, all operated with Docker Compose.

## Quick start

```bash
cp .env.example .env          # optional: the defaults match .env.example
docker compose up -d --build
```

| Service | URL / port |
| --- | --- |
| Frontend (SPA) | http://localhost:8080 |
| Backend (REST) | http://localhost:3000 |
| Health probe | http://localhost:3000/health |
| PostgreSQL | localhost:5432 |

Migrations and the deterministic seed run automatically on backend start and
are idempotent: restarting the stack never duplicates data.

## Seeded accounts

Password for every seeded account: `SEED_PASSWORD` (default `Seed!Passw0rd`).

| Email | Role |
| --- | --- |
| `admin@seed.local` | admin |
| `staff@seed.local` | staff |
| `paciente1@seed.local` .. `paciente3@seed.local` | patient (ids 1..3) |
| `gomez@seed.local` | professional (id 1) |
| `lopez@seed.local` | professional (id 2) |

Availability: weekdays 08:00–16:00 in 30-minute slots for the 14 days
following deployment; `lopez` has no Friday slots.

## Commands

```bash
# backend unit tests (Vitest, headless, no database required)
cd backend && npm test

# frontend production build
cd frontend && npm run build

# end-to-end suite against the running stack (from the repository root)
npx playwright test

# stop the stack (add -v to also drop the database volume)
docker compose down
```

Rolling a migration back (each migration declares `up` and `down`):

```bash
cd backend && npm run build && npm run migrate:down -- 1
```

`migrate:down -- N` reverts the last `N` applied migrations in reverse order
and must be run where `DATABASE_URL` points at the target database, for
example `docker compose exec backend node dist/database/rollback.js 1`.

## Repository layout

```
docs/        architecture (entity model, endpoint-to-screen map)
backend/     NestJS API, migrations, seed, Vitest unit tests
frontend/    React SPA, OAuth PKCE client, screens SCR-01..SCR-08
e2e/         Playwright suite using the data-testid contract
```

## Configuration

Everything comes from environment variables; nothing secret is committed.
See `.env.example` for the full list and the local defaults
(`POSTGRES_USER=medapp`, `POSTGRES_PASSWORD=medapp`, `POSTGRES_DB=medapp`,
`SEED_PASSWORD=Seed!Passw0rd`, fixed public client `medapp-spa` with redirect
URI `http://localhost:8080/auth/callback`).
