// Why did ORION do that? Worked out from the record of the turn (selfcheck/turns.mjs), never from the model: the same facts every time,
// said in first person. A diagnosis says what he did, which route or tool, the likely cause, and whether a fix project could help.
import { redact, recentTurns } from "./turns.mjs";

const BLOCKED = /\b(permission|denied|not authori[sz]ed|needs? approval|not allowed|forbidden|protected|consent|sign(?:ed)? in|offline|no internet|timed? ?out)\b/i;
const GAVE_UP = /\b(i couldn'?t|i could not|i can'?t|i was unable|i didn'?t actually do that|nothing was (?:started|changed)|something went wrong)\b/i;
const CLAIMED = /^(?:done|ok(?:ay)?|sure|all set|i (?:opened|set|started|moved|added|turned|sent|did))\b/i;
const CORRECTION = /^(?:no\b|nope|nah\b|wrong|that'?s (?:wrong|not (?:right|what))|not what i|i (?:said|asked|meant)|you (?:messed|got (?:it|that) wrong|didn'?t)|why (?:did|didn'?t|would))/i;
const STOP = new Set(["why", "did", "didnt", "didn't", "you", "that", "this", "the", "and", "was", "wrong", "not", "say", "said", "what", "how", "your", "ur", "just", "it", "do", "does", "its", "it's", "messed", "up", "mess", "too", "for", "lol", "pls", "please", "a", "an", "to", "me", "i", "id", "u", "d"]);

// Where a fix would most likely land, by the tool that failed (or the route that answered). Advice for the project brief, never a scope grant.
const FILES = {
  app_open: ["plugin/orion-control/src/open-request.ts", "plugin/orion-control/src/tool-moves.ts", "plugin/orion-control/src/open-request.test.ts"],
  browser_open_url: ["plugin/orion-control/src/open-request.ts", "plugin/orion-control/src/tool-moves.ts", "plugin/orion-control/src/open-request.test.ts"],
  alarm_set: ["plugin/orion-control/src/reminder-flow.ts", "plugin/orion-control/src/reminder-flow.test.ts"],
  weather_now: ["plugin/orion-control/src/weather-words.ts", "plugin/orion-control/src/tool-moves.ts"],
};
const DEFAULT_FILES = ["plugin/orion-control/src/local-routing.ts", "plugin/orion-control/src/tool-moves.ts"];

const words = (s) => (String(s ?? "").toLowerCase().match(/[a-z0-9']{3,}/g) ?? []).filter((w) => !STOP.has(w));
const quote = (s) => `"${redact(s, 80)}"`;
const argOf = (tool) => { try { const o = JSON.parse(tool.args); return o.application ?? o.url ?? o.label ?? o.location ?? Object.values(o).find((v) => typeof v === "string") ?? ""; } catch { return ""; } };
const failedTool = (t) => t.tools.find((x) => !/^(?:completed|succeeded|ok|done|verified)/i.test(x.status));

function build(t, kind, fixable, says, cause, tool, via) {
  const action = via ?? tool?.action ?? t.route?.tool ?? t.route?.flow ?? t.route?.move ?? "reply";
  return {
    turnAt: t.at, message: t.message, reply: t.reply, route: t.route, kind, fixable, says, cause,
    tool: tool?.action ?? null, signature: `${kind}:${action}`,
    title: `Fix: ${kind.replace(/-/g, " ")} on "${redact(t.message, 60)}"`,
    failingExample: { message: t.message, reply: t.reply, tool: tool?.action ?? null, args: tool?.args ?? null, error: tool?.error ?? null, route: t.route },
    files: FILES[tool?.action ?? t.route?.tool] ?? DEFAULT_FILES,
  };
}

/** What went wrong in this turn, if anything clear did. */
export function diagnoseTurn(t) {
  const bad = failedTool(t);
  const reply = t.reply ?? "";
  if (bad && CLAIMED.test(reply) && !GAVE_UP.test(reply)) {
    return build(t, "claimed-success", true, `I told you ${quote(reply)}, but the ${bad.action} call actually failed${bad.error ? ` (${redact(bad.error, 90)})` : ""}. I reported success I hadn't confirmed. That's a mistake in how I word results, on my side.`, "reply wording not checked against the tool result", bad);
  }
  if (bad && BLOCKED.test(bad.error ?? "")) {
    return build(t, "blocked", false, `When you said ${quote(t.message)} I called ${bad.action} and it was refused: ${redact(bad.error, 110)}. That's a permission or connection limit rather than a bug, so a fix project wouldn't help. It needs a setting changed.`, "permission or connection", bad);
  }
  if (bad && bad.action === "app_open" && /not found/i.test(bad.error ?? "")) {
    const named = argOf(bad) || t.message;
    return build(t, "wrong-tool", true, `I treated ${quote(named)} as an app name, so I tried to open an app that doesn't exist. That's a routing mistake on my side.`, "a site or phrase was routed as an application name", bad);
  }
  if (bad) {
    return build(t, "tool-error", true, `When you said ${quote(t.message)} I called ${bad.action} and it failed${bad.error ? `: ${redact(bad.error, 110)}` : ""}. That points to a gap in how I use that tool, not something you did.`, "tool call failed", bad);
  }
  if (GAVE_UP.test(reply) && t.tools.length === 0) {
    const how = t.route?.move === "ask" ? "my front desk chose to ask you a question instead of acting" : t.route?.move === "tool" ? "I picked a tool but nothing ran" : "no tool was run";
    return build(t, "no-action", true, `You said ${quote(t.message)} and I answered ${quote(reply)}, but ${how}. I gave up before trying. That's a routing gap on my side.`, how, undefined);
  }
  return build(t, "none", false, `I looked at what I did for ${quote(t.message)}${t.route?.flow ? ` (route: ${t.route.flow})` : t.route?.move ? ` (route: ${t.route.move}${t.route.tool ? ` ${t.route.tool}` : ""})` : ""} and I can't see a clear fault in the record. Tell me what you expected and I'll note it.`, "no failure in the record", undefined);
}

/**
 * He asked for a fix ("go into the code and fix it") and the turn he means shows no clear fault in the record (a wrong answer is not a failed
 * call). His request is the evidence: the diagnosis becomes a fixable "requested" one over that exchange. A real diagnosis is kept as it is.
 */
export function requestedDiagnosis(t, d = diagnoseTurn(t)) {
  if (d.fixable) return d;
  const via = t.route?.flow ?? t.route?.move ?? "reply";
  return build(t, "requested", true, `You asked me to fix this, and for ${quote(t.message)} the record shows no failed call, so I'll have a fix project work out the cause from that exchange${t.reply ? ` (I said ${quote(t.reply)})` : ""}.`, "reported by Nick; the record shows no clear failing call", undefined, via);
}

// "why did you reply like that", "why'd you answer that way": about the reply he just got, never an older failure (live gate 2, #43).
const LAST_REPLY = /\bwhy(?:'?d| did| would| do)?\s+(?:you|u|ya)\s+(?:reply|replied|respond|responded|answer|answered|say|said|word|put|write|wrote|talk|talked|sound)\b[^.?!]{0,25}\b(?:like (?:that|this)|that way|this way|so)\b/i;
/** The turn he is asking about: one the words name (latest first), else a question about "that reply" = the newest turn, else the latest failure, else the latest turn. */
export function pickTurn(turns, { about = "", n = 6, exclude } = {}) {
  const pool = recentTurns(turns, { n, exclude });
  if (!pool.length) return undefined;
  const want = words(about);
  const newest = [...pool].reverse();
  if (LAST_REPLY.test(String(about))) return newest[0];
  const hits = want.length ? newest.filter((t) => { const have = new Set(words(`${t.message} ${t.reply}`)); return want.some((w) => have.has(w)); }) : [];
  const named = hits.find((t) => diagnoseTurn(t).kind !== "none") ?? hits[0];
  return named ?? newest.find((t) => diagnoseTurn(t).kind !== "none") ?? newest[0];
}

/** Clear failures in a run of turns: tool errors, give-ups, corrections by his next message, and messages never answered. */
export function findFailures(turns, { quietMs = 120_000, now = Date.now() } = {}) {
  const out = [];
  turns.forEach((t, i) => {
    const d = diagnoseTurn(t);
    if (d.kind !== "none" && d.kind !== "blocked") out.push({ ...d, at: t.at });
    else if (d.kind === "blocked") out.push({ ...d, at: t.at });
    if (!t.reply && now - Date.parse(t.at) > quietMs && t.tools.length === 0) {
      out.push({ ...build(t, "dropped", true, `I never answered ${quote(t.message)}. That message was dropped on my side.`, "no reply recorded", undefined), at: t.at });
    }
    const next = turns[i + 1];
    if (next && CORRECTION.test(next.message.trim()) && t.reply && d.kind === "none") {
      out.push({ ...build(t, "corrected", true, `You corrected me after ${quote(t.message)}: ${quote(next.message)}. I answered ${quote(t.reply)}, which wasn't what you wanted.`, "his next message corrected the reply", undefined), at: t.at });
    }
  });
  const seen = new Set();
  return out.filter((f) => { const k = `${f.at}|${f.kind}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
