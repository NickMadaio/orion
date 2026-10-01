// What did ORION actually do? (ORION truthful / trace)
//
// ORION's replies have claimed things ("I've added…") that his tools never did.
// The truth is in his OpenClaw session log, one JSON object per line. This turns
// that log into turns (what Nick said, the tool calls ORION made with their
// results, what ORION replied), and grades a turn against expectations, so a
// scenario run can fail on "did not create the reminder" as well as on wording.
// (Written by Claude on 2026-10-01 for the ORION truthful run.)

const textOf = (content) => typeof content === "string" ? content
  : Array.isArray(content) ? content.filter((part) => part?.type === "text").map((part) => part.text ?? "").join("\n") : "";

/** Shell-style split that keeps quoted arguments whole. */
function splitCommand(command) {
  const out = []; let current = ""; let quote = null; let started = false;
  for (const ch of command) {
    if (quote) { if (ch === quote) quote = null; else current += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
    if (/\s/.test(ch)) { if (started) { out.push(current); current = ""; started = false; } continue; }
    current += ch; started = true;
  }
  if (started) out.push(current);
  return out;
}

/** What Nick said: after the live-facts preamble when orion-remote added one. */
function nickSaid(text) {
  if (!text.startsWith("[orion-remote] Live facts")) return text.trim();
  const lines = text.split("\n");
  const at = lines.map((line, i) => (/^(Nick:|Nick says:)/.test(line) || /Nick's message follows/.test(line) ? i : -1)).filter((i) => i >= 0).at(-1);
  if (at === undefined) return text.trim();
  const line = lines[at];
  const rest = /Nick's message follows/.test(line) ? line.replace(/^.*Nick's message follows\s*-*\s*/, "") : line.replace(/^(Nick:|Nick says:)\s*/, "");
  return [rest, ...lines.slice(at + 1)].join("\n").trim();
}

function describeCall(part) {
  const args = part.arguments ?? {};
  const command = part.name === "exec" && typeof args.command === "string" ? args.command : null;
  const words = command ? splitCommand(command) : [];
  const script = command ? (words[0] ?? "").split("/").pop()
    : part.name === "tool_call" ? String(args.tool ?? args.name ?? args.id ?? "tool_call") : part.name;
  return { id: part.id, tool: part.name, command, script, args: command ? words.slice(1) : [], ok: null, output: "", input: args };
}

/**
 * @param jsonlText an OpenClaw session .jsonl
 * @returns { turns: [{ say, reply, calls: [{ id, tool, command, script, args, ok, output, input }] }], skipped }
 *   (input: the call's raw arguments, so non-exec calls can be checked too)
 */
export function parseTrace(jsonlText) {
  if (typeof jsonlText !== "string") throw new TypeError("parseTrace needs the log text");
  const turns = []; let skipped = 0; let turn = null; const byId = new Map();
  for (const line of jsonlText.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { skipped += 1; continue; }
    if (entry?.type !== "message" || !entry.message) continue;
    const { role, content } = entry.message;
    if (role === "user") {
      turn = { say: nickSaid(textOf(content)), reply: "", calls: [] };
      turns.push(turn);
    } else if (role === "assistant" && turn) {
      const parts = Array.isArray(content) ? content : [];
      const text = textOf(content).trim();
      if (text) turn.reply = text;
      for (const part of parts.filter((p) => p?.type === "toolCall")) {
        const call = describeCall(part);
        turn.calls.push(call); byId.set(call.id, call);
      }
    } else if (role === "toolResult") {
      const call = byId.get(entry.message.toolCallId);
      if (call) { call.ok = entry.message.isError !== true; call.output = textOf(content).slice(0, 2000); }
    }
  }
  return { turns, skipped };
}

/**
 * @param turn   one turn from parseTrace
 * @param expect { mustRun?, mustNotRun?, mustInclude?, mustNotInclude?, maxCalls?, noErrors? }
 * @returns { pass, failures }
 */
export function expectTools(turn, expect = {}) {
  if (!turn || typeof turn !== "object" || !Array.isArray(turn.calls)) throw new TypeError("expectTools needs a turn");
  const failures = [];
  const scripts = turn.calls.map((call) => call.script);
  const texts = turn.calls.map((call) => call.command ?? JSON.stringify(call.input ?? {}));
  for (const name of expect.mustRun ?? []) if (!scripts.includes(name)) failures.push(`did not run ${name}`);
  for (const name of expect.mustNotRun ?? []) if (scripts.includes(name)) failures.push(`ran ${name}`);
  for (const s of expect.mustInclude ?? []) if (!texts.some((text) => text.includes(s))) failures.push(`no call included "${s}"`);
  for (const s of expect.mustNotInclude ?? []) if (texts.some((text) => text.includes(s))) failures.push(`a call included "${s}"`);
  if (Number.isInteger(expect.maxCalls) && turn.calls.length > expect.maxCalls) failures.push(`${turn.calls.length} calls (max ${expect.maxCalls})`);
  if (expect.noErrors) for (const call of turn.calls) if (call.ok === false) failures.push(`${call.script} failed`);
  return { pass: failures.length === 0, failures };
}
