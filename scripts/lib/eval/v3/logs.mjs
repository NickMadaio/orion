// Flatten ORION's real logs into one record per turn and flag likely failures
// (ORION V3 handoff §5.2). The flags only choose what gets READ first — a person
// still reads every flagged turn and a random sample of unflagged ones, because
// automated flags miss things. Read-only; pure functions over parsed lines.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)

// The app's wrapper ends "User message:"; the phone route's (orion-remote) ends with this line.
const MARKS = ["User message:\n", "--- Nick's message follows ---\n"];
const TOOL_TEXT_MAX = 4000;
const REPEAT_WINDOW_MS = 10 * 60 * 1000;


const textOf = (content) => (typeof content === "string" ? content
  : Array.isArray(content) ? content.filter((b) => b?.type === "text").map((b) => b.text).join("\n") : "");

// Where the wrapper ends: [index of the marker, its length], or null when there is no wrapper.
const markIn = (raw) => MARKS.map((m) => [raw.lastIndexOf(m), m.length]).filter(([i]) => i >= 0).sort((a, b) => b[0] - a[0])[0] ?? null;

/** What Nick actually said: the text after the last context-block marker. */
export function userTextOf(content) {
  const raw = textOf(content);
  const mark = markIn(raw);
  return (mark ? raw.slice(mark[0] + mark[1]) : raw).trim();
}

/** voice | phone | mac, from the wrapper the app or orion-remote put around the message. */
export function channelOf(content) {
  const raw = textOf(content);
  const mark = markIn(raw);
  const head = mark ? raw.slice(0, mark[0]) : raw.slice(0, 600);
  if (/SAID this out loud|voice recognition|Talk Mode active/.test(head)) return "voice";
  if (/\[orion-remote\]/.test(head)) return "phone";
  return "mac";
}

const modelOf = (m) => (m.model ? `${m.provider ?? "?"}/${m.model}` : null);
const callOf = (b) => ({ name: b.name, command: b.arguments?.command ?? null, args: b.arguments ?? {} });
// orion_task_run returns its tool metadata (whose description mentions "executed:false")
// before the outcome; keep only the outcome fields so flags see what happened. Other
// tools' output is kept as printed.
const OUTCOME_KEYS = ["executed", "status", "outcome", "reportToUser", "error"];
const show = (v) => (typeof v === "string" ? v : JSON.stringify(v));
const outcomeOf = (text, toolName) => {
  if (toolName !== "tool_call" && toolName !== "orion_task_run") return null;
  try {
    const j = JSON.parse(text);
    const d = j?.result?.details ?? j?.details ?? null;
    if (d && OUTCOME_KEYS.some((k) => k in d)) return OUTCOME_KEYS.filter((k) => d[k] !== undefined).map((k) => `${k}=${show(d[k])}`).join(" ");
    return j?.error ? `status=${j.status ?? "error"} error=${show(j.error)}` : null;
  } catch { return null; }
};

const resultOf = (m) => ({
  tool: m.toolName ?? null,
  text: (outcomeOf(textOf(m.content), m.toolName) ?? textOf(m.content)).slice(0, TOOL_TEXT_MAX),
  exitCode: m.details?.exitCode ?? null,
  isError: m.isError === true,
});

const emptyTurn = (line, at, meta, content) => ({
  source: "session", file: meta.file, sessionKey: meta.sessionKey ?? null, line, at,
  channel: channelOf(content), userText: userTextOf(content), evalClock: /TEST CLOCK/.test(textOf(content)),
  models: [], toolCalls: [], toolResults: [], reply: null, stopReason: null, latencyMs: null,
});

const addAssistant = (turn, m, at) => {
  const model = modelOf(m);
  const text = textOf(m.content).trim();
  return {
    ...turn,
    models: model && !turn.models.includes(model) ? [...turn.models, model] : turn.models,
    toolCalls: [...turn.toolCalls, ...(m.content ?? []).filter((b) => b?.type === "toolCall").map(callOf)],
    reply: text || turn.reply,
    stopReason: m.stopReason ?? turn.stopReason,
    latencyMs: text ? Date.parse(at) - Date.parse(turn.at) : turn.latencyMs,
  };
};

/** One record per user message: its tool calls, tool results, models and final reply. */
export function flattenSession(lines, meta) {
  const step = ({ turns, open }, d, index) => {
    const m = d?.message;
    if (d?.type !== "message" || !m) return { turns, open };
    if (m.role === "user") return { turns: open ? [...turns, open] : turns, open: emptyTurn(index + 1, d.timestamp, meta, m.content) };
    if (!open) return { turns, open };
    if (m.role === "assistant") return { turns, open: addAssistant(open, m, d.timestamp) };
    if (m.role === "toolResult") return { turns, open: { ...open, toolResults: [...open.toolResults, resultOf(m)] } };
    return { turns, open };
  };
  const { turns, open } = lines.reduce(step, { turns: [], open: null });
  return open ? [...turns, open] : turns;
}

/** Chat threads (~/.openclaw/orion-controlled/chats): each user message and ORION's next reply. */
export function flattenChat(chat, meta) {
  const msgs = chat?.messages ?? [];
  return msgs.flatMap((m, i) => {
    if (m.role !== "user") return [];
    const next = msgs[i + 1]?.role === "orion" ? msgs[i + 1] : null;
    return [{
      source: "chat", file: meta.file, sessionKey: null, line: i + 1, at: m.at,
      channel: m.device === "phone" ? "phone" : "mac", userText: (m.text ?? "").trim(),
      models: [], toolCalls: [], toolResults: [], reply: next?.text ?? null, stopReason: null,
      latencyMs: next ? Date.parse(next.at) - Date.parse(m.at) : null,
    }];
  });
}

// Tool output that says nothing happened. Kept in sync with the scripts in Phase 3.
const NOTHING = /NOTHING (WAS|TO) |executed["']?\s*[:=]\s*false|not changed|NOT SENT|nothing (was )?(booked|changed|moved)/i;
const SUCCESS = /\b(done|booked|moved|added|set|scheduled|cancell?ed|started|turned (on|off)|saved|sent|good to go|all set|tracked|queued)\b/i;
const CORRECTION = /^(no\b|nope)|that'?s (wrong|not)|why (isn'?t|didn'?t|is it not|did you)|\bdidn'?t (work|happen|change)|you said|\bagain\b|not what I/i;
const TIMEOUT = /timed out|still running|noOutputTimedOut":true|missing tool result/i;
const SLOW = /taking (too )?long|timed? ?out/i;
const AMBIENT_REPLY = /breaking up|didn'?t catch|what were you saying/i;

// Saying something was (or will be) recorded or done, in a turn that ran no tool.
const COMMITS = /\b(I'?ll (add|track|mark|note|save|log|get that|put|remember|book|set)|(adding|added|noted|tracked|saved|logged|booked|reported) (that|it|this)?|^noted\b|\bdone\b)/i;
const ASKS = /\?\s*$|^(want me|should I|do you want)/i;

const words = (t) => new Set(t.toLowerCase().match(/[a-z0-9']+/g) ?? []);
const similar = (a, b) => {
  const [x, y] = [words(a), words(b)];
  if (!x.size || !y.size) return false;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / new Set([...x, ...y]).size >= 0.6;
};

const isFailure = (r) => r.isError || (r.exitCode !== null && r.exitCode !== 0);

const flagsFor = (t, i, all) => {
  const next = all[i + 1];
  const sameThread = (o) => o && o.file === t.file;
  const failed = t.toolResults.some(isFailure);
  const nothing = t.toolResults.some((r) => NOTHING.test(r.text));
  const earlier = all.slice(0, i).filter((o) => sameThread(o) && Date.parse(t.at) - Date.parse(o.at) <= REPEAT_WINDOW_MS);
  return [
    failed && "tool-error",
    nothing && t.reply && SUCCESS.test(t.reply) && "claims-after-nothing",
    t.toolResults.length > 0 && t.toolResults.every(isFailure) && SUCCESS.test(t.reply ?? "") && "claims-after-error",
    t.source === "session" && t.toolCalls.length === 0 && t.reply && t.reply !== "NO_REPLY" && COMMITS.test(t.reply) && !ASKS.test(t.reply) && "claims-without-tool",
    sameThread(next) && CORRECTION.test(next.userText) && "corrected-next",
    t.userText.split(/\s+/).length >= 3 && earlier.some((o) => similar(o.userText, t.userText)) && "repeated",
    t.reply === "NO_REPLY" && "no-reply",
    t.reply === null && t.source === "session" && "no-final-reply",
    (SLOW.test(t.reply ?? "") || (sameThread(next) && SLOW.test(next.userText))) && "slow",
    t.models.some((m) => m.startsWith("ollama/")) && "local-model",
    t.models.length > 1 && "fallback",
    t.toolResults.some((r) => TIMEOUT.test(r.text)) && "tool-timeout",
    (t.channel === "voice" && AMBIENT_REPLY.test(t.reply ?? "")) && "maybe-ambient",
  ].filter(Boolean);
};

/** Adds `flags` to each turn; input order is chronological within a file. */
export function flagTurns(turns) {
  return turns.map((t, i, all) => ({ ...t, flags: flagsFor(t, i, all) }));
}
