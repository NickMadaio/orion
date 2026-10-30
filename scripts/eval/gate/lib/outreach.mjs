// Port of OutreachContext.swift: parse outreach.jsonl, label a row, and the per-turn OutreachTracker.
// The tracker is a value here: `outreachPrefix` takes the state and returns the next one, so a caller
// that wants the app's process-wide tracker keeps one state object across turns.
import { gprefix, parseISO } from "./text.mjs";

export const WINDOW_MS = 25 * 60_000;
export const ASK_WINDOW_MS = 90 * 60_000;
export const initialTracker = () => ({ lastTurnAt: null, consumedID: null });

const windowFor = (row) => (row.ask === null ? WINDOW_MS : ASK_WINDOW_MS);
const isStr = (v) => typeof v === "string";

function clock(raw) {
  if (isStr(raw) && raw !== "") return raw;
  if (Number.isInteger(raw)) {
    const two = (n) => String(n).padStart(2, "0");
    return `${two(((Math.trunc(raw / 60) % 24) + 24) % 24)}:${two(((raw % 60) + 60) % 60)}`;
  }
  return null;
}

export function derivedKind(type) {
  if (["blank", "home-gap", "away-gap", "unknown-place", "fill-blank"].includes(type)) return "blank";
  if (["mismatch", "off-plan", "not-started"].includes(type)) return "mismatch";
  return type;
}

function parseAsk(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !isStr(raw.type)) return null;
  const w = raw.window && typeof raw.window === "object" && !Array.isArray(raw.window) ? raw.window : null;
  const declared = isStr(raw.kind) && raw.kind !== "" ? raw.kind : null;
  return {
    askId: isStr(raw.askId) ? raw.askId : null, type: raw.type, declaredKind: declared,
    kind: declared ?? derivedKind(raw.type),
    windowStart: clock(w?.start), windowEnd: clock(w?.end),
    place: isStr(raw.place) ? raw.place : null,
    title: isStr(raw.title) ? raw.title : isStr(raw.blockId) ? raw.blockId : null,
  };
}

export function parseOutreach(jsonl) {
  const rows = [];
  for (const line of jsonl.split("\n")) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (!r || typeof r !== "object" || Array.isArray(r) || !isStr(r.text)) continue;
    const at = parseISO(r.at);
    if (at === null) continue;
    rows.push({
      id: isStr(r.id) ? r.id : null, text: r.text, at,
      held: r.channel === "hold" || "status" in r,   // Swift: `row["status"] != nil`, and JSON null is NSNull, not nil
      ask: parseAsk(r.ask), why: isStr(r.why) ? r.why : null,
    });
  }
  return rows;
}

const isBedtime = (row) => row.why !== null && (row.why.startsWith("proactive: bed-") || (row.why.startsWith("proactive: session-done-") && row.text.includes("past bedtime")));

function describe(ask) {
  const span = ask.windowStart === null ? null : `${ask.windowStart}-${ask.windowEnd ?? "now"}`;
  let parts;
  switch (ask.kind) {
    case "blank": parts = [`blank ask${span ? ` about ${span}` : ""}`]; break;
    case "mismatch": parts = [ask.title ?? "a planned block", ...(span ? [`planned ${span}`, "not started"] : [])]; break;
    case "voice-repeat": parts = ["a spoken question he may not have heard"]; break;
    default: parts = [`${ask.type} ask${span ? ` about ${span}` : ""}`];
  }
  if (ask.place) parts.push(ask.place === "away" || ask.place === "home" ? `he is ${ask.place}` : `he is at ${ask.place}`);
  return parts.join(", ");
}

export function outreachLabel(row, now) {
  const minutes = Math.max(0, Math.trunc((now - row.at) / 1000 / 60));
  if (!row.ask) return `[ORION context: you messaged him first, ${minutes} min ago: "${gprefix(row.text, 200)}". This message MAY be his answer.]\n`;
  return `[ORION context: ${minutes} min ago you asked "${gprefix(row.text, 200)}" (${describe(row.ask)}). If he says what he did or is doing, log it.]\n`;
}

// Swift max(by: <) keeps the FIRST of equal elements.
const newest = (rows) => rows.reduce((best, r) => (best === null || best.at < r.at ? r : best), null);

/** Returns { prefix, state }. `state` is the tracker after this turn (lastTurnAt always moves, as in the app's `defer`). */
export function outreachPrefix({ rows, now, replyTo = null, state = initialTracker() }) {
  const next = { ...state, lastTurnAt: now };
  const done = (prefix, consumedID = state.consumedID) => ({ prefix, state: { ...next, consumedID } });
  const target0 = replyTo === null ? null : rows.find((r) => r.id === replyTo && !r.held) ?? null;
  if (target0) {
    const bedtime = newest(rows.filter((r) => !r.held && isBedtime(r) && r.at > target0.at && r.at <= now));
    const target = bedtime ?? target0;
    // Swift compares optionals: nil != nil is false, so an id-less row is never consumed-checked as new.
    if (!(target.at <= now && now - target.at <= windowFor(target) && !(target.id === state.consumedID))) return done("");
    if (state.lastTurnAt !== null && state.lastTurnAt >= target.at) return done("");
    return done(outreachLabel(target, now), target.id);
  }
  const latest = newest(rows.filter((r) => !r.held));
  if (!latest) return done("");
  if (!(now - latest.at <= windowFor(latest) && latest.at <= now)) return done("");
  if (state.lastTurnAt !== null && state.lastTurnAt >= latest.at) return done("");
  if (latest.id !== null && latest.id === state.consumedID) return done("");
  return done(outreachLabel(latest, now), latest.id);
}
