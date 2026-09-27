// Merges a history summary into a simulate() forecast. Pure, no I/O, no mutation.

export const NO_HISTORY_NOTE =
  "No history has been recorded for this automation yet, so the numbers above are the ceiling only.";

export const FOCUS_NOT_MODELLED =
  "Firings during a focus session are not modelled — there is no history of past sessions to replay against.";

/**
 * Returns a new forecast object with observed data and honest notes.
 * Never mutates `forecast`, `forecast.notes` or `summary`.
 */
export function withHistory(forecast, summary) {
  const baseNotes = [...forecast.notes];

  if (!summary || summary.observedDays === 0) {
    return {
      ...forecast,
      notes: [...baseNotes, NO_HISTORY_NOTE],
    };
  }

  const observed = {
    windowDays: summary.windowDays,
    observedDays: summary.observedDays,
    firings: summary.firings,
    suppressed: summary.suppressed,
    delivered: summary.delivered,
  };

  // Replace the focus-not-modelled note in place
  const notes = baseNotes.map((note) => {
    if (note === FOCUS_NOT_MODELLED) {
      const n =
        (summary.byReason.focus_active ?? 0) +
        (summary.byReason.focus_unknown ?? 0);
      return `Focus sessions suppressed ${n} firing(s) in the observed days.`;
    }
    return note;
  });

  // Append the observed summary note
  notes.push(
    `Observed on ${observed.observedDays} of the last ${observed.windowDays} day(s): fired ${observed.firings}, suppressed ${observed.suppressed}, delivered ${observed.delivered}.`,
  );

  return {
    ...forecast,
    observed,
    notes,
  };
}
