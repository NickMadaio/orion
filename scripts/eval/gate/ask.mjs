#!/usr/bin/env node
// Send one message to ORION the way the Mac app does, byte for byte.
//
//   ask.mjs --text "whats on today" [--spoken] [--continuation] [--conversation <id>] [--reply-to <outreachId>]
//           [--model <m>] [--eval-mode on|off] [--inbound auto|on|off] [--allowed-apps "A,B"] [--dry-run] --json
//
// What it reproduces (AppState.send, GatewayClient.ask): the app-context prefix from Nick's real session,
// the spoken suffix, the continuation prefix, recentOutreach + SchedulingMemory.context, the ThinkingPolicy
// level, the session key shape, the environment, and the reply cleaning. Clock and resume phrases never
// reach ORION in the app, so they do not here either (--no-shortcuts to force them through).
import { pathToFileURL } from "node:url";
import { buildTurn, quickAnswer, isResumeRequest, struggled, BOOST_SECONDS } from "./prefix.mjs";
import { initialTracker } from "./lib/outreach.mjs";
import { paths, run, sessionStatus, routingMode, schedulingRules, outreachRows, readText } from "./lib/live.mjs";
import { runTurn, transcriptFile } from "./lib/gateway.mjs";
import { holdMarker } from "./lib/marker.mjs";

const FORBIDDEN_KEY_WORDS = /eval|test/i;   // the plugin treats such keys as internal and skips local routing
let counter = 0;
export const newConversationId = (stamp = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, "")) => `gate-${stamp}-${++counter}`;
export const sessionKeyFor = (conversation) => {
  const key = `orion-chat-${conversation}`;
  if (FORBIDDEN_KEY_WORDS.test(conversation)) throw new Error(`conversation id "${conversation}" contains "eval" or "test": the plugin would treat the session as internal`);
  return key;
};

/** What the app does when the inbound turn is logged (InboundTurnLog.record + settle): up to 6 s, never fatal. */
async function inboundTurn({ p, text, replyTo, key }) {
  const settleMs = 6000, marginMs = 1000;
  const args = [p.inboundTurn, ...(replyTo ? ["--reply-to", replyTo] : []), "--session", key, "--inject-by", String(Date.now() + settleMs - marginMs), "--text", [...text].slice(0, 200).join("")];
  const r = await run(p.node, args, { timeoutMs: settleMs });
  return { status: r.status, timedOut: r.timedOut === true };
}

/**
 * One turn. `ctx` carries what the app keeps across turns: the outreach tracker and per-session thinking boosts.
 * Returns the result object ask.mjs prints.
 */
export async function askTurn({ text, spoken = false, continuation = false, conversation, replyTo = null, model = null, inbound = "auto",
  allowedApps = [], shortcuts = true, dryRun = false }, ctx = { tracker: initialTracker(), boosts: new Map() }, p = paths()) {
  const key = sessionKeyFor(conversation ?? newConversationId());
  if (shortcuts && !continuation && (isResumeRequest(text) || quickAnswer(text) !== null)) {
    const reply = isResumeRequest(text) ? null : quickAnswer(text);
    return { reply, latencyMs: 0, model: null, routing: { answeredBy: reply ? "app clock (QuickAnswer)" : "app resume handler" }, tools: [], raw: null, sessionKey: key, bypassedGateway: true };
  }
  const status = await sessionStatus(p);
  const now = Date.now();
  const boostedUntil = ctx.boosts.get(key) ?? null;
  const turn = buildTurn({
    text, spoken, continuation, sessionStatus: status, allowedApps, rows: outreachRows(p), replyTo, now, tracker: ctx.tracker,
    rules: schedulingRules(p), routing: routingMode(p), model, boostedUntil,
  });
  ctx.tracker = turn.tracker;
  const sent = { sessionKey: key, thinking: turn.thinking, message: turn.message, sessionStatus: status };
  if (dryRun) return { ...sent, reply: null, latencyMs: 0, model, routing: null, tools: [], raw: null, dryRun: true };

  const doInbound = inbound === "on" || (inbound === "auto" && replyTo !== null);
  const inboundResult = doInbound ? await inboundTurn({ p, text, replyTo, key }) : null;
  const res = await runTurn({ p, key, message: turn.message, thinking: turn.thinking, model });
  // The app boosts thinking for ten minutes after a turn whose tool calls kept failing.
  const transcript = readText(res.sessionFile ?? transcriptFile(p, key) ?? "") ?? "";
  if (struggled(transcript, res.startedAt)) ctx.boosts.set(key, Date.now() + BOOST_SECONDS * 1000);
  return { ...sent, ...res, inbound: inboundResult };
}

function parseArgs(argv) {
  const o = { evalMode: "on", inbound: "auto", json: false, shortcuts: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const next = () => argv[++i];
    if (a === "--text") o.text = next();
    else if (a === "--spoken") o.spoken = true;
    else if (a === "--continuation") o.continuation = true;
    else if (a === "--conversation") o.conversation = next();
    else if (a === "--reply-to") o.replyTo = next();
    else if (a === "--model") o.model = next();
    else if (a === "--eval-mode") o.evalMode = next();
    else if (a === "--inbound") o.inbound = next();
    else if (a === "--allowed-apps") o.allowedApps = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--no-shortcuts") o.shortcuts = false;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--json") o.json = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.text) throw new Error("--text is required");
  if (!["on", "off"].includes(o.evalMode)) throw new Error("--eval-mode must be on or off");
  if (!["auto", "on", "off"].includes(o.inbound)) throw new Error("--inbound must be auto, on or off");
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const p = paths();
  const hold = o.evalMode === "on" && !o.dryRun ? holdMarker({ marker: p.marker, sandboxCalendar: p.sandboxCalendar, maxAgeMs: 15 * 60_000 }) : null;
  try {
    const r = await askTurn(o, undefined, p);
    const out = { reply: r.reply, latencyMs: r.latencyMs, model: r.model, routing: r.routing, tools: r.tools, raw: r.raw,
      sessionKey: r.sessionKey, thinking: r.thinking, message: r.message, status: r.status, error: r.error, inbound: r.inbound, bypassedGateway: r.bypassedGateway };
    process.stdout.write(o.json ? `${JSON.stringify(out, null, 2)}\n` : `${r.reply ?? "(no reply)"}\n`);
  } finally { hold?.release(); }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { process.stderr.write(`ask: ${e.message}\n`); process.exit(1); });
