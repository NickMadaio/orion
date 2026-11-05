// The ONE place a bedtime reader asks "what is his bedtime for this evening?" (w20 routegate).
// life-config.json holds the standing bedtime (config.bedtime) and, for one named night, sleepPlan.bedOverrides[evening] (written by
// orion-sleepplan bedtime HH:MM --tonight). orion-reach, orion-watch, the quiet hours and the nudge fallback all read through here, so a
// change he asks for moves the nudges and the quiet window with it instead of only the plan file.

/** HH:MM bedtime for the evening `evening` (YYYY-MM-DD, the date the night begins on). */
export function effectiveBedtime(config, evening) {
  const forced = config?.sleepPlan?.bedOverrides?.[evening];
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(forced ?? "") ? forced : (config?.bedtime ?? "00:00");
}

/** The config with `bedtime` replaced by that evening's effective one (a drop-in for readers that take `config.bedtime`). */
export const withEffectiveBed = (config, evening) => ({ ...config, bedtime: effectiveBedtime(config, evening) });
