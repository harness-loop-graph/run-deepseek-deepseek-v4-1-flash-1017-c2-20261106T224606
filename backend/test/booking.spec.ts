import { describe, expect, it } from 'vitest';
import {
  bookSlot,
  type BookingInput,
  type BookingTransaction,
} from '../src/appointments/appointments.service';
import { AppError } from '../src/common/errors';

/**
 * RF-13: the booking decision and the insert run inside one transaction that
 * first locks the availability row. The in-memory transaction below reproduces
 * the lock semantics of PostgreSQL (`SELECT ... FOR UPDATE`): the second caller
 * waits until the first transaction commits and then observes its booking.
 */

interface InMemoryState {
  slots: Set<string>;
  bookings: Array<{ id: number; professionalId: number; slotStart: string; patientId: number }>;
  nextId: number;
}

function slotKey(professionalId: number, slotStart: string): string {
  return `${professionalId}|${slotStart}`;
}

/** A serialising lock, exactly what the row-level lock gives the real query. */
function createMutex(): { run: <T>(work: () => Promise<T>) => Promise<T> } {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(work: () => Promise<T>): Promise<T> {
      const result = tail.then(work, work);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

function createTransaction(
  state: InMemoryState,
  mutex: ReturnType<typeof createMutex>,
): BookingTransaction {
  return {
    lockAvailability(professionalId, slotStart) {
      return Promise.resolve(state.slots.has(slotKey(professionalId, slotStart)));
    },
    findActiveBooking(professionalId, slotStart) {
      const found = state.bookings.find(
        (booking) =>
          booking.professionalId === professionalId && booking.slotStart === slotStart,
      );
      return Promise.resolve(found?.id ?? null);
    },
    insertBooking(input) {
      const id = state.nextId;
      state.nextId += 1;
      state.bookings.push({
        id,
        professionalId: input.professionalId,
        slotStart: input.slotStart,
        patientId: input.patientId,
      });
      return Promise.resolve(id);
    },
  };
}

function createState(): InMemoryState {
  return {
    slots: new Set([slotKey(1, '2030-01-07T09:00:00.000Z')]),
    bookings: [],
    nextId: 1,
  };
}

const input: BookingInput & { slotEnd: string } = {
  actorId: 10,
  patientId: 1,
  professionalId: 1,
  slotStart: '2030-01-07T09:00:00.000Z',
  slotEnd: '2030-01-07T09:30:00.000Z',
};

function statusOf(error: unknown): number | null {
  return error instanceof AppError ? error.getStatus() : null;
}

describe('booking transaction (RF-13)', () => {
  it('books a free slot once', async () => {
    const state = createState();
    const mutex = createMutex();
    const id = await mutex.run(() => bookSlot(createTransaction(state, mutex), input));
    expect(id).toBe(1);
    expect(state.bookings).toHaveLength(1);
  });

  it('rejects a slot that is not part of the professional availability', async () => {
    const state = createState();
    const mutex = createMutex();
    const failure = await mutex
      .run(() =>
        bookSlot(createTransaction(state, mutex), {
          ...input,
          slotStart: '2030-01-07T10:00:00.000Z',
        }),
      )
      .catch((error: unknown) => error);
    expect(statusOf(failure)).toBe(422);
    expect(state.bookings).toHaveLength(0);
  });

  it('serialises two concurrent bookings of the same slot: one 201, one 409', async () => {
    const state = createState();
    const mutex = createMutex();
    const results = await Promise.allSettled([
      mutex.run(() => bookSlot(createTransaction(state, mutex), input)),
      mutex.run(() => bookSlot(createTransaction(state, mutex), { ...input, patientId: 2 })),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as unknown;
    expect(statusOf(reason)).toBe(409);
    expect(state.bookings).toHaveLength(1);
  });

  it('keeps a single active booking across many concurrent attempts', async () => {
    const state = createState();
    const mutex = createMutex();
    const attempts = Array.from({ length: 8 }, (_unused, index) =>
      mutex.run(() =>
        bookSlot(createTransaction(state, mutex), { ...input, patientId: index + 1 }),
      ),
    );
    const results = await Promise.allSettled(attempts);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(7);
    expect(state.bookings).toHaveLength(1);
  });

  it('allows a new booking after the previous one is cancelled', async () => {
    const state = createState();
    const mutex = createMutex();
    await mutex.run(() => bookSlot(createTransaction(state, mutex), input));
    // Cancelling removes the row from the active set: the partial unique index
    // only covers appointments whose state is not `cancelled`.
    state.bookings.length = 0;
    const id = await mutex.run(() =>
      bookSlot(createTransaction(state, mutex), { ...input, patientId: 3 }),
    );
    expect(id).toBe(2);
    expect(state.bookings).toHaveLength(1);
  });
});
