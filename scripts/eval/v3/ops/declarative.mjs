// "Plan, then apply" (Nick, 2026-10-12: "if i asked the model normally 'if this is my schedule right
// now, what are the steps to change it from a to b' it would be able to do that"). Instead of driving
// orion-reschedule's verbs and flags, the model sees his day as a plain list and writes the day as it
// should be. Code checks it (fixed blocks untouched, no overlaps, nothing changed in the past), sends
// the problems back once, and writes the reply from what actually changed — so it cannot claim a
// change that did not happen. Graded on the same cases and graders as the tool-driving runs.
// Usage: node scripts/eval/v3/ops/declarative.mjs --job J3|J6 --model qwen3.5:9b [--think on] [--part practice] [--repeats 1]
// (Written by Claude on 2026-10-12 for the V3 local-first evaluation.)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { chat } from "../../../lib/eval/v3/ollama.mjs";
import { configure } from "../../../lib/eval/v3/presets.mjs";
import { gradeScheduleJob } from "../../../lib/eval/v3/graders.mjs";
import { appendLedger } from "../../../lib/eval/v3/ledger.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const job = arg("--job", "J3"); const part = arg("--part", "practice"); const model = arg("--model", "qwen3.5:9b");
const think = arg("--think", "off"); const repeats = Number(arg("--repeats", 1)); const only = arg("--only", null);
const V3 = join(homedir(), ".openclaw/orion-controlled/evals/v3");
const cases = JSON.parse(readFileSync(join(V3, `cases/${part}/${job.toLowerCase()}.json`), "utf8")).filter((c) => !only || c.id.includes(only));

const m = (t) => { const [h, mm] = String(t).split(":").map(Number); return h * 60 + mm; };
const hhmm = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const clockOf = (c) => (String(c.clock).match(/(\d{1,2}:\d{2})/) ?? [null, "12:00"])[1];
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const SYSTEM = `You plan Nick's day for ORION, his assistant. You get the time now, his day as a list of blocks, and what he says. Write his day as it should be after doing exactly what he asked.

Rules:
- Blocks marked FIXED (classes, plans with people) stay exactly where they are, unless he explicitly says that block changes.
- Keep every block he did not mention. You may slide movable blocks earlier or later to make room; keep their length unless he asked for a different length.
- Blocks must not overlap. Times are 24-hour HH:MM. Nothing that already ended before Now changes.
- "N more minutes" on a block he is in means it now ends at Now + N. "Between A and B" means from the end of A to the start of B.
- Use his exact titles for existing blocks; a new block gets a short title in his words.
- If what he asks cannot be done (the time has passed, not enough room before a fixed block, more hours than are left), do as much as fits only if he would want that, and put the reason in "cannot" (one plain sentence). Otherwise "cannot" is "".
- A to-do he asks to add (not a calendar block) goes in "todos_add".
- If he is only asking a question, return the day unchanged and answer in "answer".

Output JSON only: {"day":[{"title":"…","start":"HH:MM","end":"HH:MM"}],"todos_add":[],"cannot":"","answer":""}`;

const SCHEMA = { type: "object", properties: {
  day: { type: "array", items: { type: "object", properties: { title: { type: "string" }, start: { type: "string" }, end: { type: "string" } }, required: ["title", "start", "end"] } },
  todos_add: { type: "array", items: { type: "string" } }, cannot: { type: "string" }, answer: { type: "string" } }, required: ["day", "todos_add", "cannot", "answer"] };

const listDay = (day) => day.map((b) => `- ${hhmm(b.start)}–${hhmm(b.end)} ${b.title}${b.fixed ? " (FIXED)" : ""}`).join("\n");

/** Problems a person would see at a glance; sent back to the model once. */
export function problems(before, after, now) {
  const out = [];
  for (const b of after) if (!(b.end > b.start)) out.push(`"${b.title}" ends before it starts`);
  const ahead = after.filter((b) => b.end > now).sort((a, b) => a.start - b.start);
  for (let i = 1; i < ahead.length; i++) if (ahead[i].start < ahead[i - 1].end) out.push(`"${ahead[i - 1].title}" and "${ahead[i].title}" overlap`);
  for (const f of before.filter((b) => b.fixed)) {
    const same = after.find((a) => norm(a.title) === norm(f.title));
    if (!same) out.push(`fixed block "${f.title}" is missing`);
    else if (same.start !== f.start || same.end !== f.end) out.push(`fixed block "${f.title}" moved (${hhmm(f.start)}–${hhmm(f.end)} → ${hhmm(same.start)}–${hhmm(same.end)})`);
  }
  for (const b of before.filter((x) => x.end <= now)) {
    const same = after.find((a) => norm(a.title) === norm(b.title));
    if (same && (same.start !== b.start || same.end !== b.end)) out.push(`"${b.title}" already happened and cannot change`);
  }
  return out;
}

/** What changed, as orion-reschedule would print it, and the reply ORION speaks. */
export function describe(before, after, { cannot = "", todos = [] } = {}) {
  const lines = []; const said = [];
  for (const a of after) {
    const b = before.find((x) => norm(x.title) === norm(a.title));
    if (!b) { lines.push(`  added ${a.title}: ${hhmm(a.start)}–${hhmm(a.end)}`); said.push(`${a.title} is booked ${hhmm(a.start)}–${hhmm(a.end)}`); }
    else if (b.start !== a.start || b.end !== a.end) { lines.push(`  ${a.title} moved: ${hhmm(b.start)} → ${hhmm(a.start)}–${hhmm(a.end)}`); said.push(`${a.title} is now ${hhmm(a.start)}–${hhmm(a.end)}`); }
  }
  for (const b of before) if (!after.some((a) => norm(a.title) === norm(b.title))) { lines.push(`  cleared ${b.title}`); said.push(`${b.title} is off today`); }
  for (const t of todos) { lines.push(`  added to-do ${t}`); said.push(`"${t}" is on your to-do list`); }
  const changed = lines.length > 0;
  const stdout = changed ? `Changed:\n${lines.join("\n")}\nWritten to his calendar.` : `NOTHING WAS CHANGED${cannot ? `: ${cannot}` : ""}`;
  const reply = [cannot ? `I couldn't do all of that: ${cannot}` : "", changed ? `${said.join(". ")}.` : cannot ? "Nothing changed." : "Your day is unchanged."].filter(Boolean).join(" ");
  return { stdout, reply, changed };
}

async function ask(messages, cfg) {
  const res = await chat({ model, messages, format: SCHEMA, think: cfg.think, options: cfg.options, timeoutMs: 240000 });
  try { return { out: JSON.parse(res.message?.content ?? ""), ms: res.timings?.wallMs ?? 0 }; } catch { return { out: null, ms: res.timings?.wallMs ?? 0 }; }
}

const toBlocks = (day, before) => day.map((b) => ({ title: String(b.title).trim(), start: m(b.start), end: m(b.end),
  fixed: !!before.find((x) => x.fixed && norm(x.title) === norm(b.title)) })).filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end));

/** One turn: ask, check, at most one correction, then the final day and reply. */
export async function planTurn({ before, now, clock, message, history, cfg }) {
  const user = `Now: ${clock}.\n\nHis day:\n${listDay(before)}\n\n${history ? `Earlier:\n${history}\n\n` : ""}Nick: ${message}`;
  const messages = [{ role: "system", content: SYSTEM }, { role: "user", content: user }];
  let { out, ms } = await ask(messages, cfg); let total = ms; let corrected = false;
  let after = out ? toBlocks(out.day, before) : before;
  const found = out ? problems(before, after, now) : ["the output was not valid JSON"];
  if (found.length) {
    corrected = true;
    const second = await ask([...messages, { role: "assistant", content: JSON.stringify(out ?? {}) }, { role: "user", content: `Fix these and write the whole day again:\n- ${found.join("\n- ")}` }], cfg);
    total += second.ms; out = second.out ?? out;
    after = out ? toBlocks(out.day, before) : before;
    if (problems(before, after, now).length) after = before; // still broken: change nothing, say so
  }
  const cannot = String(out?.cannot ?? "") || (after === before && found.length ? "I couldn't find a way to fit that without breaking something fixed." : "");
  const d = describe(before, after, { cannot, todos: out?.todos_add ?? [] });
  const reply = out?.answer && !d.changed && !cannot ? out.answer : d.reply;
  return { after, reply, stdout: d.stdout, todos: out?.todos_add ?? [], ms: total, corrected };
}

const cfg = configure(model, { think, temp: 0 });
let pass = 0; let n = 0; const times = []; const fails = [];
for (let r = 0; r < repeats; r++) for (const c of cases) {
  const start = c.state.day.map((b) => ({ title: b.title, start: m(b.start), end: m(b.end), fixed: !!b.fixed }));
  let day = start; let reply = ""; const toolLog = []; let todos = [...(c.state.todos ?? [])]; let ms = 0;
  const now = m(clockOf(c)); const turns = c.turns ?? [c.say];
  const history = (c.history ?? []).map((x) => `${x.role === "assistant" ? "ORION" : "Nick"}: ${x.content}`);
  for (const message of turns) {
    const t = await planTurn({ before: day, now, clock: c.clock, message, history: history.join("\n"), cfg });
    toolLog.push({ canonical: "exec orion-reschedule plan", stdout: t.stdout, exit: 0 });
    day = t.after; reply = t.reply; ms += t.ms; todos = [...todos, ...t.todos];
    history.push(`Nick: ${message}`, `ORION: ${t.reply}`);
  }
  const g = gradeScheduleJob(c, { before: start, after: day, now, reply, toolLog: toolLog.slice(-1), todos: todos.map((t) => (typeof t === "string" ? t : t.title ?? "")) });
  n += 1; if (g.pass) pass += 1; else fails.push(`${c.id}: ${g.reasons.join("; ").slice(0, 160)}`); times.push(ms);
}
times.sort((a, b) => a - b);
const result = { job, part, model, think, n, pass, p50: times[Math.floor(times.length / 2)] ?? 0 };
console.log(JSON.stringify(result));
if (part === "practice") for (const f of fails) console.log("  FAIL", f);
appendLedger({ phase: "5", kind: "declarative", ...result });
