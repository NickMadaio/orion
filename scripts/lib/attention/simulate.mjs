import { rankAttention } from "./rank.mjs";
import { canInterrupt, recordInterruption } from "./budget.mjs";

/**
 * Simulate a full day of attention routing.
 *
 * @param {object[]} entries - attention queue entries
 * @param {object} options
 * @param {string} options.day - "YYYY-MM-DD" (UTC)
 * @param {number[]|null} [options.quietHours=null] - hours that are quiet
 * @param {function} [options.focusByHour=() => false] - hour -> true|false|null
 * @param {object} [options.budget={}] - budget limits
 * @returns {{ interrupts: number, filed: number, blockedByBudget: number, perHour: { hour: number, interrupts: number }[] }}
 */
export function simulateAttentionDay(entries, options = {}) {
  const {
    day,
    quietHours = null,
    focusByHour = () => false,
    budget = {},
  } = options;

  // Track which entries have been decided (interrupted or filed)
  const decided = new Set();

  let interrupts = 0;
  let filed = 0;
  let blockedByBudget = 0;
  const perHour = [];

  // Ledger for budget tracking: array of ms timestamps of interruptions
  let ledger = [];

  for (let hour = 0; hour <= 23; hour++) {
    const hh = String(hour).padStart(2, "0");
    const now = Date.parse(`${day}T${hh}:00:00Z`);

    // Filter to entries not yet decided
    const undecided = entries.filter(e => !decided.has(e.id));

    // Rank the undecided entries for this hour
    const { now: rankedNow } = rankAttention(undecided, {
      now,
      hourOfDay: hour,
      quietHours,
      focusActive: focusByHour(hour),
    });

    let hourInterrupts = 0;

    // Process each entry ranked as "now" (highest priority first)
    for (const row of rankedNow) {
      const check = canInterrupt(ledger, now, budget);

      if (check.allowed) {
        interrupts += 1;
        hourInterrupts += 1;
        ledger = recordInterruption(ledger, now);
        decided.add(row.id);
      } else {
        // Budget refused: count as blocked and filed, mark decided so it is not retried
        blockedByBudget += 1;
        filed += 1;
        decided.add(row.id);
      }
    }

    perHour.push({ hour, interrupts: hourInterrupts });
  }

  // After hour 23, any entry never decided counts as filed once
  for (const entry of entries) {
    if (!decided.has(entry.id)) {
      filed += 1;
    }
  }

  return { interrupts, filed, blockedByBudget, perHour };
}

