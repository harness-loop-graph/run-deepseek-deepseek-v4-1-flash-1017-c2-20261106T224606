import { chromium } from '@playwright/test';

const FRONT = 'http://localhost:8080';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Seed!Passw0rd';
const out = [];
let failures = 0;
function check(name, condition, extra) {
  out.push(`${condition ? 'ok  ' : 'FAIL'} ${name}${condition || extra === undefined ? '' : ' :: ' + JSON.stringify(extra)}`);
  if (!condition) failures += 1;
}

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

async function login(email) {
  await page.goto(`${FRONT}/`);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.getByTestId('logout').waitFor({ state: 'visible', timeout: 20000 });
}

async function logout() {
  await page.getByTestId('logout').click();
  await page.getByTestId('login-submit').waitFor({ state: 'visible' });
}

function isoDate(offset) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offset * 86400000).toISOString().slice(0, 10);
}

// --- admin: availability, users, roles
await login('admin@seed.local');
await page.getByTestId('nav-admin').click();
await page.getByTestId('admin-user-item').first().waitFor();
check('SCR-07 user list renders', (await page.getByTestId('admin-user-item').count()) > 0);
await page.getByTestId('admin-user-email').fill(`ui${Date.now()}@seed.local`);
await page.getByTestId('admin-role-staff').check();
await page.getByTestId('admin-user-submit').click();
await page.waitForTimeout(800);
check('SCR-07 create user ok', (await page.getByTestId('error-banner').count()) === 0);
const email = `ui2${Date.now()}@seed.local`;
await page.getByTestId('admin-user-email').fill(email);
await page.getByTestId('admin-user-submit').click();
await page.waitForTimeout(800);
check('SCR-07 duplicate email shows error banner', (await page.getByTestId('error-banner').count()) === 1);
const availSelect = page.getByTestId('admin-availability-professional');
check('SCR-07 availability professional select present', (await availSelect.count()) === 1);
await page.waitForTimeout(500);
const slotCount = await page.getByTestId('admin-availability-slot').count();
check('SCR-07 availability slots listed', slotCount > 0, slotCount);
// add one slot row and save
await page.getByTestId('admin-availability-add').click();
const starts = page.getByTestId('admin-slot-start');
const ends = page.getByTestId('admin-slot-end');
const last = (await starts.count()) - 1;
await starts.nth(last).fill(`${isoDate(20)}T09:00`);
await ends.nth(last).fill(`${isoDate(20)}T09:30`);
await page.getByTestId('admin-availability-submit').click();
await page.waitForTimeout(1000);
check('SCR-07 availability saved without error', (await page.getByTestId('error-banner').count()) === 0, await page.getByTestId('error-banner').allTextContents());
await page.getByTestId('nav-audit').click();
await page.getByTestId('audit-submit').click();
await page.getByTestId('audit-item').first().waitFor();
await page.getByTestId('audit-action').fill('availability_replaced');
await page.getByTestId('audit-submit').click();
await page.waitForTimeout(800);
check('SCR-08 action filter works', (await page.getByTestId('audit-item').count()) >= 1);
await page.getByTestId('audit-action').fill('no_such_action');
await page.getByTestId('audit-submit').click();
await page.getByTestId('empty-state').waitFor();
check('SCR-08 empty state', (await page.getByTestId('empty-state').count()) === 1);
await logout();

// --- staff: search availability (no booking) and agenda
await login('staff@seed.local');
await page.getByTestId('nav-search').click();
await page.getByTestId('search-professional').waitFor();
await page.getByTestId('search-from').fill(isoDate(4));
await page.getByTestId('search-to').fill(isoDate(4));
await page.getByTestId('search-submit').click();
await page.waitForTimeout(800);
check('SCR-03 staff sees slots or empty state', (await page.getByTestId('slot-item').count()) > 0 || (await page.getByTestId('empty-state').count()) === 1);
check('SCR-03 staff cannot book', (await page.getByTestId('book-submit').count()) === 0);
await page.getByTestId('nav-agenda').click();
await page.getByTestId('agenda-view').waitFor();
await page.waitForTimeout(800);
check('SCR-04 staff agenda loads', (await page.getByTestId('loading-indicator').count()) === 0);
await logout();

// --- patient: detail page, history, booking with validation
await login('paciente1@seed.local');
await page.getByTestId('nav-bookings').click();
await page.waitForTimeout(600);
const details = page.getByRole('link', { name: 'Details' }).first();
if ((await details.count()) > 0) {
  await details.click();
  await page.waitForTimeout(800);
  check('SCR-05 patient detail loads', (await page.getByTestId('error-banner').count()) === 0, await page.getByTestId('error-banner').allTextContents());
}
await page.getByTestId('nav-history').click();
await page.waitForTimeout(800);
check('SCR-06 patient history loads', (await page.getByTestId('error-banner').count()) === 0, await page.getByTestId('error-banner').allTextContents());
const timeline = page.getByTestId('history-timeline');
check('SCR-06 timeline present', (await timeline.count()) === 1);
if ((await page.getByTestId('attachment-download').count()) > 0) {
  await page.getByTestId('attachment-download').first().click();
  await page.waitForTimeout(500);
  check('SCR-06 attachment download no error', (await page.getByTestId('error-banner').count()) === 0, await page.getByTestId('error-banner').allTextContents());
}
await page.getByTestId('nav-search').click();
await page.getByTestId('search-professional').waitFor();
await page.getByTestId('search-from').fill(isoDate(10));
await page.getByTestId('search-to').fill(isoDate(2));
await page.getByTestId('search-submit').click();
await page.waitForTimeout(300);
check('SCR-03 client validation for reversed range', (await page.getByTestId('error-banner').count()) === 1);
await logout();

// --- professional: agenda click to detail, encounter validation
await login('gomez@seed.local');
await page.getByTestId('nav-agenda').click();
await page.getByTestId('agenda-view').waitFor();
await page.waitForTimeout(900);
const items = page.getByTestId('appointment-item');
if ((await items.count()) > 0) {
  await items.first().click();
  await page.waitForTimeout(900);
  check('SCR-05 professional detail loads', (await page.getByTestId('error-banner').count()) === 0, await page.getByTestId('error-banner').allTextContents());
  await page.getByTestId('encounter-submit').click();
  await page.waitForTimeout(300);
  check('SCR-05 client validation for empty encounter', (await page.getByTestId('error-banner').count()) === 1);
  await page.getByTestId('encounter-notes').fill('Nota con <script>alert(1)</script> y "comillas"');
  await page.getByTestId('encounter-diagnosis').fill('Diagnóstico <b>prueba</b>');
  await page.getByTestId('encounter-submit').click();
  await page.getByTestId('encounter-confirmation').waitFor();
  const text = await page.getByTestId('encounter-notes-text').first().textContent();
  check('RF-22 notes rendered as text', text.includes('<script>'), text);
  check('RF-22 no injected script element', (await page.locator('script', { hasText: 'alert(1)' }).count()) === 0);
}
await page.getByTestId('nav-history').click();
await page.getByTestId('history-patient').waitFor();
await page.waitForTimeout(600);
const options = await page.getByTestId('history-patient').locator('option').count();
check('SCR-06 professional patient selector', options > 1, options);
await page.getByTestId('history-patient').selectOption({ index: 1 });
await page.waitForTimeout(800);
check('SCR-06 professional history loads', (await page.getByTestId('error-banner').count()) === 0, await page.getByTestId('error-banner').allTextContents());
await logout();

check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5));

await browser.close();
console.log(out.join('\n'));
console.log(failures === 0 ? '\nUI PASSED' : `\n${failures} UI FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
