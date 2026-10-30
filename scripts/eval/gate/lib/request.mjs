// Port of AppState.agentRequest(userText:spoken:) and the continuation prefix, plus the full message
// GatewayClient.ask builds around it. The app context is injected from Nick's REAL session state.
import { outreachPrefix, initialTracker } from "./outreach.mjs";
import { schedulingContext } from "./scheduling.mjs";
import { thinkingLevel } from "./thinking.mjs";

// Both strings are copied from AppState.swift; parity.test.mjs pins them against that source.
export const SPOKEN_SUFFIX = 'Nick SAID this out loud and your answer will be SPOKEN: one to three short sentences, no lists, no markdown, times as "8:15 PM". Offer detail only if he asks.';
export const CONTINUATION_PREFIX = "(Continuing — my last message was cut off mid-sentence; this is the rest of it. Answer the whole thing.) ";

const ACTIVE = ["running", "paused", "waiting-for-return"];

/** What the app says about the focus session, from `orion-session status --json` (SessionWire fields). */
export function describeSession(status) {
  if (!status || !ACTIVE.includes(status.status)) return "inactive";
  const phase = status.phase ?? "focus";
  const task = typeof status.task === "string" ? status.task.replaceAll("\n", " ") : "unnamed task";
  const block = Number.isInteger(status.blockNumber) && Number.isInteger(status.totalBlocks) ? `block ${status.blockNumber} of ${status.totalBlocks}` : "current block";
  return `active; ${phase}, ${block}, user-set task: ${task}`;
}

/** Enforcer.isArmed is `allowlist.confirmed && !released`; the status wire reports exactly that as `enforcement`. */
export const enforcementArmed = (status) => !["off", "released", undefined, null].includes(status?.enforcement);

/** `userText` is what the app passes after the optional continuation prefix. */
export function agentRequest({ userText, spoken = false, sessionStatus = null, allowedApps = [], armed = enforcementArmed(sessionStatus) }) {
  const allowed = allowedApps.length === 0 ? "none established" : [...allowedApps].sort().join(", ");
  return [
    "[Orion app context — factual state supplied by the native app]",
    `Focus session: ${describeSession(sessionStatus)}.`,
    `Firm enforcement: ${armed ? "active" : "not active"}.`,
    `Temporary allowed work apps: ${allowed}.`,
    "Treat the session status and allowed apps as current operating context. Do not claim an app is blocked, hidden, or quit unless a tool confirms it.",
    spoken ? SPOKEN_SUFFIX : "",
    "",
    "User message:",
    userText,
  ].join("\n");
}

/** A spoken request whose first half already went out: the rest is marked as finishing it. */
export const continuationText = (text) => CONTINUATION_PREFIX + text;

/**
 * Everything the app puts on the `openclaw agent` command line for one turn.
 * `tracker` is the app's process-wide OutreachTracker state; the new state comes back in `tracker`.
 */
export function buildTurn({ text, spoken = false, continuation = false, sessionStatus, allowedApps = [], rows = [], replyTo = null, now, tracker = initialTracker(), rules = null, routing, model = null, boostedUntil = null }) {
  const userText = continuation && spoken ? continuationText(text) : text;
  const request = agentRequest({ userText, spoken, sessionStatus, allowedApps });
  const { prefix, state } = outreachPrefix({ rows, now, replyTo, state: tracker });
  const message = prefix + schedulingContext({ text: request, routing, rules }) + request;
  return { request, message, thinking: thinkingLevel({ text: request, model, boostedUntil, now }), tracker: state };
}
