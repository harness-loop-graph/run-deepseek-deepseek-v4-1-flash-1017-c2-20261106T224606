/**
 * A versioned, reversible migration (RF-02). The schema is created only by
 * running `up` statements; `down` restores the previous state so every
 * migration can be rolled back in reverse order.
 */
export interface Migration {
  version: string;
  description: string;
  up: string[];
  down: string[];
}
