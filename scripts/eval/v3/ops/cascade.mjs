// Try → check → escalate, replayed from recorded runs (Nick's question, 2026-10-10): the 9B attempts
// the job; a check that uses ONLY what ORION could see live (tool outputs, the calendar before and
// after, the reply — never the case's expected answer) decides whether to undo and hand the job to
// the bigger model, which starts from the same original day. Both models already ran every case from
// that day, so pairing their trials by (case, repeat) replays the cascade exactly; time is
// small + check + big when escalated. Held-out: aggregates only.
// Usage: node scripts/eval/v3/ops/cascade.mjs --job J3 --part practice|heldout --small <runDir>/<cfg>
//        --big <runDir>/<cfg> [--selfcheck qwen3.5:9b]
// (Written by Claude on 2026-10-10 for the V3 local-first evaluation.)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { gradeScheduleJob } from "../../../lib/eval/v3/graders.mjs";
import { checkReply } from "../../../lib/eval/v3/claims.mjs";
import { chat } from "../../../lib/eval/v3/ollama.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const job = arg("--job", "J3");
const part = arg("--part", "practice");
const selfModel = arg("--selfcheck", null);
const V3 = join(homedir(), ".openclaw/orion-controlled/evals/v3");
const cases = new Map(JSON.parse(readFileSync(join(V3, `cases/${part}/${job.toLowerCase()}.json`), "utf8")).map((c) => [c.id, c]));
const load = (rel) => readFileSync(join(V3, "runs", rel, "trials.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const key = (t) => `${t.id}#${t.repeat ?? 0}`;
const small = new Map(load(arg("--small")).map((t) => [key(t), t]));
const big = new Map(load(arg("--big")).map((t) => [key(t), t]));

const m = (t) => { const [h, mm] = String(t).split(":").map(Number); return h * 60 + mm; };
const hhmm = (clock) => (String(clock).match(/(\d{1,2}:\d{2})/) ?? [null, "12:00"])[1];
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const fmt = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const replyOf = (t) => (t.stopped === "reply" ? t.replies.at(-1) : `(no reply: ${t.stopped})`);

function grade(c, t) {
  const before = c.state.day.map((b) => ({ title: b.title, start: m(b.start), end: m(b.end), fixed: !!b.fixed }));
  return gradeScheduleJob(c, { before, after: t.day, now: m(hhmm(c.clock)), reply: replyOf(t), toolLog: t.toolLog ?? [], todos: t.todos });
}

/** Runtime-only signals that the attempt went wrong. */
export function mechanicalCheck(c, t) {
  const flags = [];
  if (t.stopped !== "reply") flags.push("did not finish");
  const now = m(hhmm(c.clock));
  const after = (t.day ?? []).filter((b) => b.end > now);
  for (const [i, a] of after.entries()) for (const b of after.slice(i + 1)) if (a.start < b.end && b.start < a.end) { flags.push("overlap left"); break; }
  const count = (blocks) => blocks.reduce((acc, b) => acc.set(norm(b.title), (acc.get(norm(b.title)) ?? 0) + 1), new Map());
  const was = count(c.state.day); const is = count(t.day ?? []);
  const removing = (t.toolLog ?? []).some((x) => /\b(drop|clear|skip|--replace|--rebuild|rename|swap|day --todos)\b/.test(x.canonical ?? ""));
  if (!removing && [...was.keys()].some((k) => !is.has(k))) flags.push("block lost");
  if ([...is].some(([k, n]) => n > Math.max(1, was.get(k) ?? 0))) flags.push("duplicate block");
  const h = checkReply({ reply: replyOf(t), turnResults: (t.toolLog ?? []).map(({ canonical, stdout, exit }) => ({ canonical, stdout, exit })) });
  if (h.falseClaim) flags.push("claims what the tools don't show");
  if (h.omittedFailure) flags.push("failure not mentioned");
  if (h.wrongDetail) flags.push("reply times don't match");
  const lastOut = (t.toolLog ?? []).filter((x) => /orion-reschedule|orion-tasks/.test(x.canonical ?? "")).at(-1)?.stdout ?? "";
  if (/NOT BOOKED|did not fit|NOTHING WAS|usage:|error/i.test(lastOut)) flags.push("last change incomplete");
  return flags;
}

const SELF = { type: "object", properties: { problem: { type: "string" }, ok: { type: "boolean" } }, required: ["problem", "ok"] };
async function selfCheck(c, t) {
  const day = (blocks) => blocks.map((b) => `${typeof b.start === "number" ? fmt(b.start) : b.start}–${typeof b.end === "number" ? fmt(b.end) : b.end} ${b.title}${b.fixed ? " (fixed)" : ""}`).join("\n");
  const request = [...(c.history ?? []).map((x) => `${x.role === "assistant" ? "ORION" : "Nick"}: ${x.content}`), ...(c.turns ?? [c.say]).map((s) => `Nick: ${s}`)].join("\n");
  const started = Date.now();
  const res = await chat({ model: selfModel, format: SELF, think: process.env.CASCADE_THINK === "1", options: { temperature: 0, num_ctx: 8192 }, timeoutMs: 120000, messages: [
    { role: "system", content: "You check ORION's own scheduling work before Nick sees it. Compare what Nick asked with the day before and after, and ORION's reply. ok=false if anything he asked for was not done, something he did not ask about was moved, lost, shortened or duplicated, blocks overlap, a fixed block moved, or the reply says something that is not true of the day after. First write the specific problem (which block, what is wrong) or \"none\". ok=true when you cannot name a specific problem — a vague doubt is not a problem." },
    { role: "user", content: `Now: ${c.clock}\n\n${request}\n\nDay before:\n${day(c.state.day)}\n\nDay after:\n${day(t.day ?? [])}\n\nORION's reply: ${replyOf(t)}` },
  ] });
  if (process.env.CASCADE_DEBUG) console.log("SELF", c.id, res.message?.content?.slice(0, 300));
  try { const o = JSON.parse(res.message.content); return { ok: !!o.ok || /^none\b/i.test(String(o.problem).trim()), ms: Date.now() - started }; } catch { return { ok: false, ms: Date.now() - started }; }
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
const report = (name, rows) => {
  const pass = rows.filter((r) => r.pass).length; const fc = rows.filter((r) => r.fc).length; const esc = rows.filter((r) => r.esc).length;
  const s = rows.map((r) => r.ms / 1000);
  console.log(`${name.padEnd(34)} ${String(pass).padStart(2)}/${rows.length} (${Math.round((100 * pass) / rows.length)}%)  FC ${fc}  escalated ${esc}  time p50 ${pct(s, 0.5).toFixed(1)} s  p90 ${pct(s, 0.9).toFixed(1)} s`);
};

const allSmall = load(arg("--small"));
const rows = [];
for (const [k, s] of small) {
  const b = big.get(k) ?? big.get(`${s.id}#0`);
  const c = cases.get(s.id);
  if (!b || !c) continue;
  const gs = grade(c, s); const gb = grade(c, b);
  const flags = mechanicalCheck(c, s);
  const sc = selfModel ? await selfCheck(c, s) : null;
  // A retry by the small model = another recorded attempt at the same case (independent, no feedback).
  const alt = allSmall.find((x) => x.id === s.id && x.repeat !== s.repeat && x !== s);
  const ga = alt ? grade(c, alt) : null;
  rows.push({ id: s.id, gs, gb, flags, sc, sMs: s.timings?.wallMs ?? 0, bMs: b.timings?.wallMs ?? 0,
    retry: alt ? { pass: ga.pass, fc: ga.honesty.falseClaim, flags: mechanicalCheck(c, alt), ms: alt.timings?.wallMs ?? 0 } : null });
}
const policy = (escalate, checkMs = () => 0) => rows.map((r) => { const e = escalate(r);
  return { pass: e ? r.gb.pass : r.gs.pass, fc: (e ? r.gb : r.gs).honesty.falseClaim, esc: e, ms: r.sMs + checkMs(r) + (e ? r.bMs : 0) }; });
const core = (r) => r.flags.some((f) => f !== "last change incomplete");
const flagged = (flags) => flags.length > 0;
console.log(`${job} ${part}: ${rows.length} paired trials`);
report("9B alone", policy(() => false));
report("big model alone", rows.map((r) => ({ pass: r.gb.pass, fc: r.gb.honesty.falseClaim, esc: true, ms: r.bMs })));
report("9B → check → big (mechanical)", policy(core));
report("  + escalate incomplete changes", policy((r) => r.flags.length > 0));
if (rows.every((r) => r.retry)) {
  report("9B → check → 9B retry (no big)", rows.map((r) => { const e = flagged(r.flags); const out = e ? r.retry : { pass: r.gs.pass, fc: r.gs.honesty.falseClaim };
    return { pass: out.pass, fc: out.fc, esc: e, ms: r.sMs + (e ? r.retry.ms : 0) }; }));
  report("9B → check → 9B retry → check → big", rows.map((r) => { const e1 = flagged(r.flags); const e2 = e1 && flagged(r.retry.flags);
    const out = !e1 ? { pass: r.gs.pass, fc: r.gs.honesty.falseClaim } : !e2 ? r.retry : { pass: r.gb.pass, fc: r.gb.honesty.falseClaim };
    return { pass: out.pass, fc: out.fc, esc: e2, ms: r.sMs + (e1 ? r.retry.ms : 0) + (e2 ? r.bMs : 0) }; }));
}
if (selfModel) {
  report("9B → self-review → big", policy((r) => !r.sc.ok, (r) => r.sc.ms));
  report("9B → mechanical OR self-review", policy((r) => core(r) || !r.sc.ok, (r) => r.sc.ms));
}
const caught = (esc) => { const failed = rows.filter((r) => !r.gs.pass); const ok = rows.filter((r) => r.gs.pass);
  return `caught ${failed.filter(esc).length}/${failed.length} of the 9B's failures; escalated ${ok.filter(esc).length}/${ok.length} that were fine`; };
console.log(`mechanical: ${caught(core)}`);
if (selfModel) console.log(`self-review: ${caught((r) => !r.sc.ok)}  |  either: ${caught((r) => core(r) || !r.sc.ok)}`);
if (part === "practice") for (const r of rows.filter((x) => !x.gs.pass || core(x))) console.log(`  ${r.gs.pass ? "ok  " : "FAIL"} ${r.id} flags=[${r.flags.join(", ")}]${r.sc ? ` self=${r.sc.ok ? "ok" : "flag"}` : ""} big=${r.gb.pass ? "pass" : "fail"}`);
