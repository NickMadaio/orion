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
import { homedir } from "node:os";
import { isBedtimeRow } from "./bedtime-guard.mjs";

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
  const spokeSince = (row) => turns.some((t) => t > Date.parse(row.at) && t < now);
  const inWindow = (row) => { const age = now - Date.parse(row.at); return age >= 0 && age <= windowFor(row); };
  if (replyTo) {
    const exact = rows.find((r) => r.id === replyTo || r.askId === replyTo || `${r.id}-orion` === replyTo);
    if (exact) {
      // A newer bedtime line wins over the older line he tapped; a tapped line he has spoken since is not the answer, and the
      // tap counts for the ask window only (review 2026-10-23: a stale tapped id answered messages hours later).
      const bedtime = rows.filter((r) => isBedtimeRow(r) && Date.parse(r.at) > Date.parse(exact.at) && Date.parse(r.at) <= now)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
      const target = bedtime ?? exact;
      return Date.parse(target.at) <= now && now - Date.parse(target.at) <= ASK_WINDOW_MS && !spokeSince(target) ? target : null;
    }
  }
  const latest = rows.reduce((best, r) => (!best || Date.parse(r.at) > Date.parse(best.at) ? r : best), null);
  if (!latest || !inWindow(latest) || spokeSince(latest)) return null;   // he already said something after it: not the answer
  return latest;
}

/** What kind of message it was, for the reader of his reply. */
export function outreachKind(row) {
  const why = String(row?.why ?? "");
  if (isBedtimeRow(row) || (!why && /\b(?:past bedtime|it's \d{1,2}:\d{2} [AP]M, bedtime|Still up at)\b/i.test(String(row?.text ?? "")))) return "bedtime";
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
export function injectArgs({ sessionKey, row, timeoutMs = 3000 }) {
  return ["gateway", "call", "chat.inject", "--json", "--timeout", String(Math.round(timeoutMs)),
    "--params", JSON.stringify({ sessionKey, message: assistantTurn(row), label: INJECT_LABEL })];
}

/** The gateway's own idle reset (openclaw.json session.reset): only "idle" mode is understood; anything else means "do not inject". */
export function idleResetMs(config) {
  const reset = config?.session?.reset;
  if (!reset || reset.mode !== "idle") return null;
  const minutes = Number(reset.idleMinutes);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : null;
}

/**
 * Whether `sessionKey` is a live gateway session an inject may go into: it exists and was used within the idle window, with 2 min
 * to spare (an inject refreshes it, and must never be what keeps an old conversation alive). Returns the store's key for it.
 * Seams: ORION_GATEWAY_SESSIONS (sessions.json), ORION_GATEWAY_CONFIG (openclaw.json).
 */
export function sessionLive({ sessionKey, now = Date.now(), env = process.env } = {}) {
  const read = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };
  const idle = idleResetMs(read(env.ORION_GATEWAY_CONFIG || join(homedir(), ".openclaw/openclaw.json")));
  if (!idle) return { ok: false, reason: "no idle reset known" };
  const store = read(env.ORION_GATEWAY_SESSIONS || join(homedir(), ".openclaw/agents/main/sessions/sessions.json")) ?? {};
  const want = String(sessionKey).toLowerCase();
  const key = Object.keys(store).find((k) => k.toLowerCase() === `agent:main:${want}` || k.toLowerCase() === want);
  const at = Number(key ? store[key]?.updatedAt : NaN);
  if (!key || !Number.isFinite(at)) return { ok: false, reason: "no such session yet" };
  if (now - at > idle - 2 * 60_000) return { ok: false, reason: "idle past the reset window" };
  return { ok: true, key: sessionKey };
}
