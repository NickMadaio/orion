// "The steps from A to B" (Nick, 2026-10-12). The model reads his day as a plain list and answers with
// the steps — a small JSON form (move / resize / add / drop / skip / extend / swap / tidy). Code turns
// each step into the exact orion-reschedule command (paths, flags, quoting, no "&"), runs it on the
// private sandbox day with ORION's real scheduler doing the arithmetic, sends any failure back once,
// and writes the reply from what the scripts printed. Same cases and graders as the tool-driving runs.
// Usage: node scripts/eval/v3/ops/steps.mjs --job J3|J6 --model qwen3.5:9b [--think on] [--part practice] [--only <id part>]
// (Written by Claude on 2026-10-12 for the V3 local-first evaluation.)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { chat } from "../../../lib/eval/v3/ollama.mjs";
import { configure } from "../../../lib/eval/v3/presets.mjs";
import { gradeScheduleJob } from "../../../lib/eval/v3/graders.mjs";
import { createSandbox } from "../../../lib/eval/v3/sandbox.mjs";
import { appendLedger } from "../../../lib/eval/v3/ledger.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const job = arg("--job", "J3"); const part = arg("--part", "practice"); const model = arg("--model", "qwen3.5:9b");
const think = arg("--think", "off"); const only = arg("--only", null); const verbose = process.argv.includes("--verbose");
const V3 = join(homedir(), ".openclaw/orion-controlled/evals/v3");
const cases = JSON.parse(readFileSync(join(V3, `cases/${part}/${job.toLowerCase()}.json`), "utf8")).filter((c) => !only || c.id.includes(only));
const hhmm = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const clockOf = (c) => (String(c.clock).match(/(\d{1,2}:\d{2})/) ?? [null, "12:00"])[1];
const minuteOf = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

export const SYSTEM = `You are ORION's scheduler for Nick. You get the time now, his day (FIXED = a class or plan with people) and what he says. Answer with the STEPS that turn his day into what he asked for. ORION's scheduler carries them out and slides the other movable blocks for you, so never list a block just to shift it out of the way.

Steps (JSON objects):
- {"do":"move","title":T,"to":"HH:MM"}  — same length, new start
- {"do":"move","title":T,"after":A,"before":B}  — fill the time from the end of block A to the start of block B ("between A and B")
- {"do":"move","title":T,"after":A}  — start right after block A
- {"do":"move","title":T,"until":"HH:MM"}  — keep its start, end at that time
- {"do":"resize","title":T,"minutes":N}  — its total length becomes N
- {"do":"extend","title":T,"until":"HH:MM"}  — a block running long (he is in it) ends later; "N more minutes" = Now + N
- {"do":"add","title":T,"minutes":N,"at":"HH:MM"} or {"do":"add","title":T,"minutes":N,"after":A,"before":B}  — a new block
- {"do":"drop","title":T}  — remove a movable block
- {"do":"skip","title":T}  — he is not going to a class/plan today (only if he says so)
- {"do":"swap","title":T,"with":U}
- {"do":"tidy"}  — separate overlaps
Use the titles exactly as listed. Only what he asked for; nothing else.

If it cannot be done (the time has passed, it does not fit before a fixed block, more hours than are left), give no steps for that part and say why in "cannot" (one plain sentence). A to-do he wants added (not a calendar block) goes in "todos_add". If he only asks a question, give no steps and answer in "answer".

Output JSON only: {"steps":[…],"todos_add":[],"cannot":"","answer":""}`;

const SCHEMA = { type: "object", properties: {
  steps: { type: "array", items: { type: "object", properties: { do: { type: "string", enum: ["move", "resize", "extend", "add", "drop", "skip", "swap", "tidy"] }, title: { type: "string" }, to: { type: "string" }, after: { type: "string" }, before: { type: "string" }, until: { type: "string" }, minutes: { type: "number" }, at: { type: "string" }, with: { type: "string" } }, required: ["do"] } },
  todos_add: { type: "array", items: { type: "string" } }, cannot: { type: "string" }, answer: { type: "string" } }, required: ["steps", "todos_add", "cannot", "answer"] };

const listDay = (day) => day.map((b) => `- ${hhmm(b.start)}–${hhmm(b.end)} ${b.title}${b.fixed ? " (FIXED)" : ""}`).join("\n");
// Production refuses & ; | > inside exec arguments, so a title is cut before them ("…Design & Impl" → "…Design").
const safe = (t) => String(t ?? "").split(/[&;|>]/)[0].trim().replace(/"/g, "");
const q = (t) => `"${safe(t)}"`;
const time = (t) => (/^\d{1,2}:\d{2}$/.test(String(t ?? "").trim()) ? String(t).trim().padStart(5, "0") : null);

/** One step → one orion-reschedule command, or a reason it cannot be built. */
export function commandFor(step, day) {
  const startOf = (title) => { const b = day.find((x) => x.title.toLowerCase().includes(safe(title).toLowerCase())); return b ? hhmm(b.start) : null; };
  const s = step ?? {};
  switch (s.do) {
    case "move":
      if (time(s.to)) return `orion-reschedule move ${q(s.title)} --to ${time(s.to)}`;
      if (s.after) return `orion-reschedule move ${q(s.title)} --after ${q(s.after)}${s.before ? ` --before ${q(s.before)}` : ""}`;
      if (time(s.until)) return `orion-reschedule move ${q(s.title)} --until ${time(s.until)}`;
      return { error: `move "${s.title}" needs to, after or until` };
    case "resize": return Number.isFinite(s.minutes) ? `orion-reschedule resize ${q(s.title)} ${Math.round(s.minutes)}` : { error: "resize needs minutes" };
    case "extend": return time(s.until) ? `orion-reschedule extend ${q(s.title)} --until ${time(s.until)}` : Number.isFinite(s.minutes) ? `orion-reschedule extend ${q(s.title)} ${Math.round(s.minutes)}` : { error: "extend needs until" };
    case "add": {
      if (!Number.isFinite(s.minutes)) return { error: `add "${s.title}" needs minutes` };
      const where = time(s.at) ? ` --at ${time(s.at)}` : s.after ? ` --after ${q(s.after)}` : "";
      const before = s.before ? (time(s.before) ?? startOf(s.before)) : null;
      return `orion-reschedule add ${q(s.title)} ${Math.round(s.minutes)}${where}${before ? ` --before ${before}` : ""}`;
    }
    case "drop": return `orion-reschedule drop ${q(s.title)}`;
    case "skip": return `orion-reschedule skip ${q(s.title)}`;
    case "swap": return s.with ? `orion-reschedule swap ${q(s.title)} ${q(s.with)}` : { error: "swap needs with" };
    case "tidy": return "orion-reschedule tidy";
    default: return { error: `unknown step "${s.do}"` };
  }
}

const FAILED = /NOT BOOKED|NOTHING WAS|did not fit|usage:|Error|not a real block|is in the past|no block called/i;

async function ask(messages, cfg) {
  const res = await chat({ model, messages, format: SCHEMA, think: cfg.think, options: cfg.options, timeoutMs: 240000 });
  try { return { out: JSON.parse(res.message?.content ?? ""), ms: res.timings?.wallMs ?? 0 }; } catch { return { out: null, ms: res.timings?.wallMs ?? 0 }; }
}

/** Run the steps; returns tool log entries and the failures to send back. */
async function apply(sb, steps) {
  const log = []; const failures = [];
  for (const step of steps ?? []) {
    const command = commandFor(step, sb.state().day);
    if (typeof command !== "string") { failures.push(command.error); continue; }
    const { stdout, exit } = await sb.run(command);
    log.push({ canonical: `exec ${command}`, stdout, exit });
    if (exit !== 0 || FAILED.test(stdout)) failures.push(`${command.replace("orion-reschedule ", "")} → ${String(stdout).split("\n").find((l) => FAILED.test(l)) ?? String(stdout).split("\n")[0]}`);
  }
  return { log, failures };
}

/** The reply ORION speaks, written only from what the scripts printed. */
export function replyFrom(log, { cannot = "", answer = "", todos = [], failures = [] } = {}) {
  const changed = log.flatMap((l) => String(l.stdout).split("\n").map((x) => x.trim()).filter((x) => /moved|planned|added|cleared|is now|skipped|resized|extended|swapped|separated/i.test(x) && !FAILED.test(x)));
  const parts = [];
  if (changed.length) parts.push(`Done: ${changed.slice(0, 4).join("; ")}.`);
  if (todos.length) parts.push(`Added to your to-dos: ${todos.join(", ")}.`);
  if (failures.length) parts.push(`I couldn't do all of it: ${failures[0].split("→").pop().trim()}`);
  if (cannot) parts.push(`That can't be done: ${cannot}`);
  if (!parts.length) parts.push(answer || "Your day is unchanged.");
  return parts.join(" ");
}

const cfg = configure(model, { think, temp: 0 });
let pass = 0; const times = []; const fails = [];
for (const c of cases) {
  const now = clockOf(c);
  const sb = createSandbox({ day: c.state?.day ?? [], now, todos: c.state?.todos ?? [] });
  try {
    if (!(await sb.preflight())) throw new Error(`sandbox preflight failed for ${c.id}`);
    const before = sb.state().day; const toolLog = []; let reply = ""; let ms = 0; const todos = [];
    const history = (c.history ?? []).map((x) => `${x.role === "assistant" ? "ORION" : "Nick"}: ${x.content}`);
    for (const message of c.turns ?? [c.say]) {
      const user = () => `Now: ${c.clock}.\n\nHis day:\n${listDay(sb.state().day)}\n\n${history.length ? `Earlier:\n${history.join("\n")}\n\n` : ""}Nick: ${message}`;
      const messages = [{ role: "system", content: SYSTEM }, { role: "user", content: user() }];
      let { out, ms: t1 } = await ask(messages, cfg); ms += t1;
      let { log, failures } = await apply(sb, out?.steps);
      toolLog.push(...log);
      if (failures.length) { // one correction, from the day as it is now
        const fix = await ask([{ role: "system", content: SYSTEM }, { role: "user", content: `${user()}\n\nYour steps ${JSON.stringify(out?.steps ?? [])} hit problems:\n- ${failures.join("\n- ")}\nThe day above is how it is now. Give the steps still needed, or say why in "cannot".` }], cfg);
        ms += fix.ms; out = { ...fix.out, todos_add: [...(out?.todos_add ?? []), ...(fix.out?.todos_add ?? [])] };
        const second = await apply(sb, fix.out?.steps); toolLog.push(...second.log); failures = second.failures; log = [...log, ...second.log];
      }
      for (const t of out?.todos_add ?? []) { await sb.run(`orion-tasks add ${q(t)}`); todos.push(t); }
      reply = replyFrom(log, { cannot: out?.cannot ?? "", answer: out?.answer ?? "", todos: out?.todos_add ?? [], failures });
      history.push(`Nick: ${message}`, `ORION: ${reply}`);
      if (verbose) console.log(`  [${c.id}] steps=${JSON.stringify(out?.steps)} cannot=${out?.cannot ?? ""}\n    reply=${reply}`);
    }
    const state = sb.state();
    const g = gradeScheduleJob(c, { before, after: state.day, now: minuteOf(now), reply, toolLog: toolLog.slice(-3), todos: state.todos });
    if (g.pass) pass += 1; else fails.push(`${c.id}: ${g.reasons.join("; ").slice(0, 170)}`);
    times.push(ms);
  } finally { sb.cleanup(); }
}
times.sort((a, b) => a - b);
const result = { job, part, model, think, n: cases.length, pass, p50: times[Math.floor(times.length / 2)] ?? 0 };
console.log(JSON.stringify(result));
if (part === "practice") for (const f of fails) console.log("  FAIL", f);
appendLedger({ phase: "5", kind: "steps", ...result });
