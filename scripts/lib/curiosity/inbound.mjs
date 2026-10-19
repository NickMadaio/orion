// Nick's replies, as the curiosity loop needs them (spec 3.5): every message he sends is a row in
// inbound-turns.jsonl ({ at }), so an ignored ask can be told from an answered one, and a reply to an ask closes it.
// One implementation for both paths: the phone (orion-remote) and the Mac (GatewayClient) call `orion-inbound-turn`.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const TURNS_FILE = "inbound-turns.jsonl";
/** A reply with no explicit id still answers the newest open ask if it comes within this window (a text from away is late). */
export const REPLY_WINDOW_MS = 90 * 60_000;

/** "nothing", "nothing really", "just chilling": a reply that answers a blank ask without logging anything.
 *  Same pattern as NOTHING_REPLY in plugin/orion-control/src/schedule-flow.ts (a test keeps them equal). */
export const NOTHING_REPLY = /^\s*(?:(?:um+|uh+|well|oh|nah|nope|no)[,.\s]+)?(?:nothing(?: much| really| special)?|not much|just (?:chilling|relaxing|resting|hanging out)|(?:i was )?(?:just )?chilling)\s*[.!]*\s*$/i;

/** The times of his earlier messages, in ms. */
export function readTurns(dir) {
  const file = join(dir, TURNS_FILE);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").flatMap((line) => {
    try { const t = Date.parse(JSON.parse(line).at); return Number.isNaN(t) ? [] : [t]; } catch { return []; }
  });
}

export function appendTurn(dir, now) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, TURNS_FILE), `${JSON.stringify({ at: now.toISOString() })}\n`);
}

/**
 * The open ask this message answers: the one `replyTo` names (the ask id, or the id of the outreach message that carried it),
 * else the newest open ask in the window that no earlier message of his has answered since it was sent.
 * @param turns times (ms) of his earlier messages, not counting this one
 */
export function askAnswered({ asks, replyTo = null, turns = [], now = Date.now() }) {
  const open = asks.filter((a) => !a.answeredAt && !a.dropped);   // a dropped ask never reached him: nothing to answer
  if (replyTo) return open.find((a) => a.askId === replyTo || a.reachId === replyTo) ?? null;
  const newest = open.reduce((best, a) => (!best || Date.parse(a.at) > Date.parse(best.at) ? a : best), null);
  if (!newest) return null;
  const sent = Date.parse(newest.at);
  if (Number.isNaN(sent) || now - sent < 0 || now - sent > REPLY_WINDOW_MS) return null;
  return turns.some((t) => t > sent) ? null : newest;
}

export const outcomeFor = (text) => (NOTHING_REPLY.test(String(text ?? "")) ? "nothing" : "answered");
