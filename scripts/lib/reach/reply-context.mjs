// What ORION said first, linked to the message Nick sends back (WP5 2026-10-16, reworked 2026-10-23).
//
// 2026-10-23 audit: every reply to a proactive message opened a NEW gateway session (45-min idle reset), and ORION's
// message was in no session at all: it lived only in outreach.jsonl and the phone thread. The reply's model saw a one-line
// label at best, the front desk saw nothing, and "I'm meal prepping. That's why. Sorry." was answered "What time or how long
// do you mean?". Now the picked message is written INTO the reply's session as ORION's own assistant turn (gateway
// chat.inject) right before the turn runs, and the label stays as a fallback for when the inject cannot run.
//
// One rule for every path (phone orion-remote, Mac app, orion-inbound-turn): the exact id when the reply carries one
// (`replyTo`, a reply to a notification or the bubble open now), else the single newest DELIVERED row within 25 minutes,
// or 90 if it is an ask, that no later message of his has answered.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const PLAIN_WINDOW_MS = 25 * 60_000;
export const ASK_WINDOW_MS = 90 * 60_000;
/** The label `chat.inject` writes on ORION's injected turn (gateway limit 100 chars). */
export const INJECT_LABEL = "orion-outreach";

/** The newest row per id (orion-reach logs a row twice when it falls back to the phone), without held, dropped or failed ones. */
export function deliveredRows(jsonl) {
  const byId = new Map();
  for (const line of String(jsonl ?? "").split("\n")) {
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row.text !== "string" || !Number.isFinite(Date.parse(row.at))) continue;
    byId.set(row.id ?? row.at, row);
  }
  return [...byId.values()].filter((r) => r.channel !== "hold" && !r.status);
}

export function readDelivered(dir) {
  const file = join(dir, "outreach.jsonl");
  return existsSync(file) ? deliveredRows(readFileSync(file, "utf8")) : [];
}

const windowFor = (row) => (row.ask ? ASK_WINDOW_MS : PLAIN_WINDOW_MS);

/**
 * The outreach row this message answers, or null.
 * @param turns times (ms) of his EARLIER messages (not this one), any channel
 */
export function pickOutreach(rows, { replyTo = null, turns = [], now = Date.now() } = {}) {
  if (replyTo) {
    const exact = rows.find((r) => r.id === replyTo || r.askId === replyTo || `${r.id}-orion` === replyTo);
    if (exact && now - Date.parse(exact.at) <= ASK_WINDOW_MS * 4) return exact;   // he tapped it: hours late is still that message
  }
  const latest = rows.reduce((best, r) => (!best || Date.parse(r.at) > Date.parse(best.at) ? r : best), null);
  if (!latest) return null;
  const sent = Date.parse(latest.at);
  const age = now - sent;
  if (age < 0 || age > windowFor(latest)) return null;
  if (turns.some((t) => t > sent && t < now)) return null;   // he already said something after it: this message is not the answer
  return latest;
}

/** What kind of message it was, for the reader of his reply. */
export function outreachKind(row) {
  const why = String(row?.why ?? "");
  if (/^proactive: bed-|past bedtime|bedtime|Still up at/i.test(`${why} ${row?.text ?? ""}`)) return "bedtime";
  if (row?.ask?.type === "mismatch" || row?.ask?.kind === "mismatch" || /^plan: /.test(why)) return "start";
  if (row?.ask || /\?\s*$/.test(String(row?.text ?? ""))) return "question";
  return "info";
}

const clock = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** ORION's own turn, as the session history gets it: his words, plus when and that ORION started the conversation. */
export function assistantTurn(row) {
  return `${String(row.text).slice(0, 600)}\n\n(sent by ORION at ${clock(new Date(row.at))}, ORION started this conversation)`;
}

/** The label the turn's message carries when the inject did not run (and as a cross-check when it did). */
export function outreachLabel(row, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - Date.parse(row.at)) / 60000));
  return `[ORION context: you messaged him first, ${minutes} min ago (${outreachKind(row)}): "${String(row.text).slice(0, 200)}". His message below is most likely his reply to it.]`;
}

/** argv for `openclaw gateway call chat.inject` (the gateway appends it as an assistant message and refreshes the session). */
export function injectArgs({ sessionKey, row }) {
  return ["gateway", "call", "chat.inject", "--json", "--timeout", "5000",
    "--params", JSON.stringify({ sessionKey, message: assistantTurn(row), label: INJECT_LABEL })];
}
