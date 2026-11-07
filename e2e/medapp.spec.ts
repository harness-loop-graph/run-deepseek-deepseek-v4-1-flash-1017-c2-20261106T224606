import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end suite for the fixed testability contract.
 *
 * Every interaction goes through the SPA exactly like a person would: the
 * login form, the role-dependent navigation and the `data-testid` attributes
 * declared by SPEC.md. The suite is serial because the booking, encounter and
 * history tests share one appointment.
 */

const PASSWORD = process.env.SEED_PASSWORD ?? 'Seed!Passw0rd';

const ROLE_USERS = {
  patient: 'paciente1@seed.local',
  patient2: 'paciente2@seed.local',
  professional: 'gomez@seed.local',
  staff: 'staff@seed.local',
  admin: 'admin@seed.local',
} as const;

const NAV_BY_ROLE: Record<keyof typeof ROLE_USERS, string[]> = {
  patient: ['nav-bookings', 'nav-search', 'nav-history'],
  patient2: ['nav-bookings', 'nav-search', 'nav-history'],
  professional: ['nav-agenda', 'nav-history'],
  staff: ['nav-agenda', 'nav-search'],
  admin: ['nav-admin', 'nav-audit'],
};

const ALL_NAV = [
  'nav-bookings',
  'nav-search',
  'nav-agenda',
  'nav-history',
  'nav-admin',
  'nav-audit',
];

function utcDate(offsetDays: number): string {
  const now = new Date();
  const day = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) +
      offsetDays * 24 * 60 * 60 * 1000,
  );
  return day.toISOString().slice(0, 10);
}

/** Next weekday at least two days ahead, inside the seeded 14-day window. */
function bookingDay(): string {
  for (let offset = 2; offset <= 8; offset += 1) {
    const day = new Date(`${utcDate(offset)}T00:00:00.000Z`).getUTCDay();
    if (day !== 0 && day !== 6) {
      return utcDate(offset);
    }
  }
  return utcDate(2);
}

async function login(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('login-email')).toBeVisible();
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('logout')).toBeVisible({ timeout: 20_000 });
}

async function logout(page: Page): Promise<void> {
  await page.getByTestId('logout').click();
  await expect(page.getByTestId('login-submit')).toBeVisible();
}

/** Books the slot at `slotIndex` with Gómez and returns the appointment id. */
async function bookAppointment(page: Page, slotIndex: number): Promise<number> {
  await page.getByTestId('nav-search').click();
  await expect(page.getByTestId('search-professional')).toBeVisible();
  const day = bookingDay();
  const select = page.getByTestId('search-professional');
  const gomezOption = select.locator('option', { hasText: 'Gómez' }).first();
  await expect(gomezOption).toHaveCount(1);
  const gomezId = await gomezOption.getAttribute('value');
  expect(gomezId).not.toBeNull();
  await select.selectOption(gomezId!);
  await page.getByTestId('search-from').fill(day);
  await page.getByTestId('search-to').fill(day);
  await page.getByTestId('search-submit').click();
  const slots = page.getByTestId('slot-item');
  await expect(slots.first()).toBeVisible();
  await expect(slots.nth(slotIndex)).toBeVisible();
  await slots.nth(slotIndex).click();
  await page.getByTestId('book-submit').click();
  const confirmation = page.getByTestId('booking-confirmation');
  await expect(confirmation).toBeVisible();
  const text = (await confirmation.textContent()) ?? '';
  const match = /Appointment (\d+) confirmed/.exec(text);
  expect(match).not.toBeNull();
  return Number.parseInt(match![1], 10);
}

test.describe.serial('MedApp end to end', () => {
  test('every role signs in and sees exactly its navigation items', async ({ page }) => {
    for (const [role, email] of Object.entries(ROLE_USERS)) {
      await login(page, email);
      const expected = NAV_BY_ROLE[role as keyof typeof ROLE_USERS];
      for (const testId of ALL_NAV) {
        const item = page.getByTestId(testId);
        if (expected.includes(testId)) {
          await expect(item, `${role} must see ${testId}`).toHaveCount(1);
        } else {
          await expect(item, `${role} must not see ${testId}`).toHaveCount(0);
        }
      }
      await logout(page);
    }
  });

  test('protected routes redirect an anonymous visitor to the login screen', async ({ page }) => {
    await page.goto('/bookings');
    await expect(page.getByTestId('login-submit')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/admin');
    await expect(page.getByTestId('login-submit')).toBeVisible();
  });

  test('a patient books and then cancels an appointment', async ({ page }) => {
    await login(page, ROLE_USERS.patient2);
    const appointmentId = await bookAppointment(page, 0);

    await page.getByTestId('nav-bookings').click();
    const item = page.locator(`[data-testid="appointment-item"][data-appointment-id="${appointmentId}"]`);
    await expect(item).toBeVisible();
    await item.getByTestId('cancel-appointment').click();
    await expect(item).toHaveCount(0);
    // The cancelled booking leaves SCR-02. When the cancellation empties the
    // portal the explicit empty state is shown instead (RF-24).
    if ((await page.getByTestId('appointment-item').count()) === 0) {
      await expect(page.getByTestId('empty-state')).toBeVisible();
    }
    await logout(page);
  });

  test('a professional records an encounter for an assigned patient', async ({ page }) => {
    await login(page, ROLE_USERS.patient);
    const appointmentId = await bookAppointment(page, 1);
    await logout(page);

    await login(page, ROLE_USERS.professional);
    await page.getByTestId('nav-agenda').click();
    const item = page.locator(`[data-testid="appointment-item"][data-appointment-id="${appointmentId}"]`);
    await expect(item).toBeVisible();
    await item.click();

    const marker = `Nota clínica ${Date.now()}`;
    await page.getByTestId('encounter-notes').fill(marker);
    await page.getByTestId('encounter-diagnosis').fill('Lumbalgia mecánica');
    await page.getByTestId('encounter-submit').click();
    await expect(page.getByTestId('encounter-confirmation')).toBeVisible();
    await expect(page.getByTestId('encounter-notes-text').first()).toHaveText(marker);
    await logout(page);

    // The patient reads the recorded encounter in their own clinical history.
    await login(page, ROLE_USERS.patient);
    await page.getByTestId('nav-history').click();
    const timeline = page.getByTestId('history-timeline');
    await expect(timeline).toBeVisible();
    await expect(timeline).toContainText(marker);
    await expect(timeline).toContainText('Lumbalgia mecánica');
    await logout(page);
  });

  test('staff sees scheduling data but no clinical content', async ({ page }) => {
    await login(page, ROLE_USERS.staff);
    await page.getByTestId('nav-agenda').click();
    await expect(page.getByTestId('agenda-view')).toBeVisible();
    await expect(page.getByTestId('nav-history')).toHaveCount(0);
    await logout(page);
  });

  test('an admin queries the audit log', async ({ page }) => {
    await login(page, ROLE_USERS.admin);
    await page.getByTestId('nav-audit').click();
    await expect(page.getByTestId('audit-submit')).toBeVisible();
    await expect(page.getByTestId('audit-item').first()).toBeVisible();
    await logout(page);
  });
});
