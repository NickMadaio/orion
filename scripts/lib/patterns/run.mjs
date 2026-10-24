// Evidence in, routines out (pure), and the plain-words listing `orion-patterns routines` prints.
import { eveningEpisodes, habitualCells } from "./episodes.mjs";
import { statementEvidence } from "./statements.mjs";
import { answersAsStatements } from "./store.mjs";
import { learnRoutines, MIN_OCCURRENCES, WINDOW_DAYS } from "./learn.mjs";
import { clock, WEEKDAYS } from "./time.mjs";

/** @param ev gatherEvidence() output (or a fixture of the same shape) */
export function learnFromEvidence(ev, { now = new Date() } = {}) {
  // where the phone spends most nights counts as home, but only when no home place is known (never on top of a known home)
  const habitual = new Set(ev.homeKnown === true ? [] : habitualCells(ev.fixes ?? []));
  const known = ev.isHome ?? (() => false);
  const isHome = (f) => known(f) || habitual.has(`${f.lat.toFixed(3)},${f.lon.toFixed(3)}`);
  const evenings = eveningEpisodes(ev.fixes ?? [], { isHome, sessions: ev.sessions ?? [], sleeps: ev.sleeps ?? [] });
  const statements = [...statementEvidence([...(ev.messages ?? []), ...(ev.askReplies ?? [])]), ...answersAsStatements(ev.answers ?? [])];
  const routines = learnRoutines({ evenings, statements, activities: ev.activities ?? [], corroborations: ev.corroborations ?? [], wakes: ev.wakes ?? {}, now, placeName: ev.placeName ?? null });
  return { routines, evenings, statements };
}

const via = (o) => `${o.date} ${o.outcome === "hit" ? "yes" : "no"} (${o.via.join("+")}${Number.isFinite(o.start) ? ` ${clock(o.start)}–${clock(o.end)}` : ""}${o.cell ? ` ${o.cell}` : ""})`;

/** Each routine with its evidence dates; tentative ones say how many more weeks they need. */
export function explain(routines) {
  if (!routines.length) return `No routines learned yet (a routine needs ${MIN_OCCURRENCES} occurrences on the same weekday within ${WINDOW_DAYS / 7} weeks).`;
  return routines.map((r) => {
    const head = `${r.status.toUpperCase()} ${r.label ?? "(unnamed)"} — ${r.weekdayName}s${Number.isFinite(r.start) ? ` ~${clock(r.start)}–${clock(r.end)}` : ""}`
      + ` · confidence ${r.confidence} · ${r.occurrences} time(s), ${r.misses} broken${r.labelSource ? ` · label: ${r.labelSource}` : ""}`;
    const after = r.kind === "away-evening" && Number.isFinite(r.nextWake) ? `\n  next morning: woke ~${clock(r.nextWake)}${Number.isFinite(r.usualWake) ? ` (usually ~${clock(r.usualWake)})` : ""}` : "";
    const need = r.status === "tentative" ? `\n  needs ${MIN_OCCURRENCES - r.occurrences} more ${r.weekdayName} before it is used` : "";
    return `${head}${after}${need}\n  evidence: ${r.evidence.map(via).join("; ")}`;
  }).join("\n");
}

/** Per weekday, what the evenings looked like (for a dry run): out / home / unknown dates. */
export function eveningSummary(evenings) {
  const by = Array.from({ length: 7 }, () => ({ out: [], home: [] }));
  for (const e of Object.values(evenings)) if (e.status !== "unknown") by[new Date(`${e.date}T12:00:00`).getDay()][e.status].push(e.date);
  return by.map((x, i) => `${WEEKDAYS[i].slice(0, 3)}: out ${x.out.sort().join(", ") || "-"} | home ${x.home.sort().join(", ") || "-"}`).join("\n");
}
