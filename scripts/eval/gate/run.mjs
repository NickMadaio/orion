#!/usr/bin/env node
// Drive a scenario bank through the exact gate (ask.mjs's path), one item at a time, concurrency 1.
// Per item: snapshot, run every turn in ONE conversation, record the full effect diff, undo, verify the
// undo, write the result. Rubric grading happens later in a separate grader; this records everything.
//
//   run.mjs <scenarios.json> [--out <dir>] [--readonly] [--only id,id] [--start N] [--eval-mode on|off]
//           [--max-age-min 90] [--inbound auto|on|off] [--allowed-apps "A,B"] [--tier sandbox|live|all]
//   run.mjs <scenarios.json> --dry-run [--tier …] [--only …]   print every item's setup; writes and sends nothing
//   run.mjs --recover <out dir>      restore from an interrupted run's in-flight snapshot
//   run.mjs --clean-sandbox          remove leftover sandbox files (eval-calendar.json ...) so a run may start
//
// Run it under launchd (launch.sh): Calendar access belongs to the gateway node's grant, not a terminal's.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { askTurn } from "./ask.mjs";
import { initialTracker } from "./lib/outreach.mjs";
import { paths } from "./lib/live.mjs";
import { holdMarker } from "./lib/marker.mjs";
import { effectSince, restoreState, snapshotState, trackedFiles, verifyRestore } from "./lib/state.mjs";
import { checkReplies, summarize, validateScenarios } from "./lib/scenarios.mjs";
import { applyPlan, planSetup, renderTokens } from "./lib/setup.mjs";
import { seedOutreach } from "./lib/seed-outreach.mjs";
import { cleanupNotes, notesBefore, notesEffect } from "./lib/computer-evidence.mjs";
import { dryRun } from "./lib/dry-run.mjs";
import { cleanSandbox, leftoverMessage, leftoverSandboxFiles, recentInbound } from "./lib/sandbox-guard.mjs";

const stampNow = () => new Date().toISOString().slice(5, 16).replace(/[-:T]/g, "");

const writableFiles = (p) => new Map(trackedFiles(p).map((f) => [basename(f), f]));
export const tierOf = (item) => (item.setup?.live === true ? "live" : "sandbox");

/** Strip what bloats a result: the model's system prompt report and context accounting. */
const slimRaw = (raw) => (raw && typeof raw === "object" ? { runId: raw.runId, status: raw.status, summary: raw.summary, payloads: raw.result?.payloads } : raw);

export async function runItem({ item, index, stamp, p, ctx, opts }) {
  const conversation = `gate-${stamp}-${index + 1}`;
  const startedAt = new Date().toISOString();
  const snap = await snapshotState(p);
  mkdirSync(opts.outDir, { recursive: true });
  // Written BEFORE the setup: a crash from here on is undone by --recover, sandbox files included.
  writeFileSync(join(opts.outDir, "inflight-snapshot.json"), JSON.stringify({ id: item.id, snap }));
  const planned = await planSetup(p, item.setup, { writable: writableFiles(p), sessionId: snap.sessionId });
  // "ORION just said X" becomes a real outreach row at the item's effective now (sandbox clock, or real time when live).
  const { plan, rows, replyTo } = seedOutreach(item, planned, planned.sandbox ? Date.parse(planned.sandbox.now) : Date.now());
  const seededOutreachIds = rows.map((x) => x.id);
  // The ids the undo must remove, kept where --recover can find them after a crash.
  writeFileSync(join(opts.outDir, "inflight-snapshot.json"), JSON.stringify({ id: item.id, snap, seededOutreachIds }));
  const setup = { applied: plan.applied, unmet: plan.unmet, tier: tierOf(item) };
  const turns = [];
  // A sandboxed item lives at the sandbox's `now`: the app-side clock (outreach window, thinking boost, QuickAnswer)
  // says the same time the scripts and the plugin do. Its tracker is its own, so a fake clock never leaks across items.
  const itemCtx = plan.sandbox ? { ...ctx, tracker: initialTracker(), clock: () => Date.parse(plan.sandbox.now) } : ctx;
  const clock = itemCtx.clock ?? Date.now;
  // The effect is measured from AFTER the setup (what the item did, not what the fixture did); the undo goes back to
  // BEFORE it. While a sandbox is live the to-do read is the sandbox's, so its baseline must be taken inside it too.
  let base = snap;
  const probeNotes = item.area === "computer" && opts.notes !== false;
  let notesSeen = null;
  try {
    applyPlan(p, plan);
    base = await snapshotState(p);
    if (probeNotes) notesSeen = await notesBefore();
    for (const t of item.turns) {
      const text = renderTokens(t.text, clock());
      const r = await askTurn({ text, spoken: t.spoken === true, replyTo: replyTo(t.replyToOutreach), conversation, inbound: opts.inbound, allowedApps: opts.allowedApps }, itemCtx, p);
      turns.push({ text, ...(text !== t.text ? { template: t.text } : {}), spoken: t.spoken === true, replyToOutreach: t.replyToOutreach ?? null, message: r.message, thinking: r.thinking, sessionStatus: r.sessionStatus,
        reply: r.reply, latencyMs: r.latencyMs, model: r.model, routing: r.routing, tools: r.tools, status: r.status, error: r.error, inbound: r.inbound, bypassedGateway: r.bypassedGateway, raw: slimRaw(r.raw) });
    }
  } catch (e) {
    turns.push({ text: "(runner error)", reply: null, error: String(e?.message ?? e) });
  }
  // The diff is taken BEFORE the undo: it is the record of what the item did to Nick's world (or to the sandbox).
  const effect = await effectSince(p, base, { seeded: plan.sandbox });
  if (probeNotes) {
    const found = await notesEffect(notesSeen, opts.notes);
    effect.notes = await cleanupNotes(found, opts.notes);
    if (found.created.length) effect.changedAnything = true;
  }
  const actions = await restoreState(p, snap, effect, { seededOutreachIds, runId: `${stamp}-${item.id}` });
  const verified = await verifyRestore(p, snap, { seededOutreachIds });
  rmSync(join(opts.outDir, "inflight-snapshot.json"), { force: true });
  return {
    id: item.id, area: item.area, wording: item.wording, pair: item.pair ?? null, writes: item.writes, expect: item.expect, setup: { ...item.setup, ...setup },
    conversation, sessionKey: `orion-chat-${conversation}`, startedAt, finishedAt: new Date().toISOString(),
    turns, effect, cleanup: { actions, verified }, checks: checkReplies(item.expect, turns.map((t) => t.reply)),
  };
}

export async function runScenarios({ scenarios, opts, p = paths(), log = (s) => process.stdout.write(`${s}\n`) }) {
  const errors = validateScenarios(scenarios);
  if (errors.length) throw new Error(`invalid scenario file:\n  ${errors.join("\n  ")}`);
  const only = opts.only ? new Set(opts.only) : null;
  const tier = opts.tier ?? "all";
  const selected = (item) => (!only || only.has(item.id)) && (tier === "all" || tierOf(item) === tier);
  if (opts.dryRun) return dryRun({ items: scenarios.slice(opts.start ?? 0).filter(selected), p, log, hostZone: opts.hostZone });
  // Any sandbox file, whatever its age, would make scripts and the plugin disagree about the clock and the calendar.
  const leftover = leftoverSandboxFiles(p);
  if (leftover.length) throw new Error(leftoverMessage(leftover));
  // While an item runs, Nick's own turns would see the sandbox: warn (not block) when he was just active.
  const inbound = recentInbound(p);
  if (inbound) log(`WARNING: an inbound non-gate turn arrived ${inbound.minutesAgo} min ago. While an item runs his own turns see the sandbox clock and calendar; run full sweeps while he is away or asleep.`);
  const stamp = opts.stamp ?? stampNow();
  mkdirSync(opts.outDir, { recursive: true });
  const resultsPath = join(opts.outDir, "results.jsonl");
  let stopping = false, expired = false;
  const hold = opts.evalMode === "on"
    ? holdMarker({ marker: p.marker, sandboxCalendar: p.sandboxCalendar, maxAgeMs: (opts.maxAgeMin ?? 90) * 60_000, signals: false, onExpire: () => { expired = true; } })
    : null;
  // First signal: finish and undo the item in flight, then stop. Second signal: let go of the marker and leave now.
  const onSignal = (sig) => () => { if (stopping) { hold?.release(); process.exit(1); } stopping = true; log(`${sig}: finishing and undoing the current item, then stopping (signal again to leave now)`); };
  const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map((s) => [s, onSignal(s)]);
  if (opts.handleSignals !== false) for (const [s, f] of handlers) process.on(s, f);

  const ctx = { tracker: initialTracker(), boosts: new Map() };
  const results = [];
  try {
    for (let i = opts.start ?? 0; i < scenarios.length; i++) {
      const item = scenarios[i];
      if (!selected(item)) continue;
      if (stopping || expired) { log(`stopped before ${item.id}: ${expired ? "marker max age reached" : "signal"}`); break; }
      let result;
      const skip = opts.readonly && item.writes ? "readonly mode"
        // Without the marker bridge-path ignores eval-calendar.json, so a sandboxed item's writes would hit his real calendar.
        : item.setup?.calendar && !item.setup?.live && opts.evalMode !== "on" ? "sandboxed item needs --eval-mode on" : null;
      if (skip) {
        result = { id: item.id, area: item.area, wording: item.wording, pair: item.pair ?? null, writes: item.writes, skipped: skip, turns: [] };
      } else {
        result = await runItem({ item, index: i, stamp, p, ctx, opts });
      }
      results.push(result);
      appendFileSync(resultsPath, `${JSON.stringify(result)}\n`);
      log(`[${i + 1}/${scenarios.length}] ${item.id} ${result.skipped ? `skipped (${result.skipped})` : `${result.turns.map((t) => `${t.latencyMs ?? "-"}ms`).join(",")} regex:${result.checks.hasRegex ? (result.checks.passed ? "pass" : "FAIL") : "-"} restore:${result.cleanup.verified.ok ? "ok" : "PROBLEM"}`}`);
    }
  } finally {
    hold?.release();
    for (const [s, f] of handlers) process.removeListener(s, f);
  }
  const summary = { ...summarize(results), outDir: opts.outDir, stamp, evalMode: opts.evalMode, readonly: Boolean(opts.readonly), stoppedEarly: stopping || expired || undefined };
  writeFileSync(join(opts.outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return { results, summary };
}

/** Restore from the snapshot an interrupted run left behind. */
export async function recover(outDir, p = paths()) {
  const file = join(outDir, "inflight-snapshot.json");
  if (!existsSync(file)) return { recovered: false, reason: "no in-flight snapshot: nothing to recover" };
  const { id, snap, seededOutreachIds = [] } = JSON.parse(readFileSync(file, "utf8"));
  const effect = await effectSince(p, snap);
  const actions = await restoreState(p, snap, effect, { seededOutreachIds, runId: `recover-${id}` });
  const verified = await verifyRestore(p, snap, { seededOutreachIds });
  if (verified.ok) rmSync(file, { force: true });
  return { recovered: verified.ok, id, actions, verified };
}

function parseArgs(argv) {
  const o = { evalMode: "on", inbound: "auto", allowedApps: [] };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const next = () => argv[++i];
    if (a === "--out") o.outDir = next();
    else if (a === "--readonly") o.readonly = true;
    else if (a === "--only") o.only = next().split(",");
    else if (a === "--start") o.start = Number(next());
    else if (a === "--eval-mode") o.evalMode = next();
    else if (a === "--max-age-min") o.maxAgeMin = Number(next());
    else if (a === "--inbound") o.inbound = next();
    else if (a === "--allowed-apps") o.allowedApps = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--recover") o.recover = next();
    else if (a === "--clean-sandbox") o.cleanSandbox = true;
    else if (a === "--tier") o.tier = next();
    else if (a === "--dry-run") o.dryRun = true;
    else if (a.startsWith("--")) throw new Error(`unknown argument ${a}`);
    else rest.push(a);
  }
  if (!["on", "off"].includes(o.evalMode)) throw new Error("--eval-mode must be on or off");
  if (o.tier !== undefined && !["sandbox", "live", "all"].includes(o.tier)) throw new Error("--tier must be sandbox, live or all");
  return { o, file: rest[0] };
}

async function main() {
  const { o, file } = parseArgs(process.argv.slice(2));
  if (o.cleanSandbox) { const gone = cleanSandbox(paths()); process.stdout.write(`removed ${gone.length} sandbox file(s)${gone.length ? `: ${gone.join(", ")}` : ""}\n`); return; }
  if (o.recover) { process.stdout.write(`${JSON.stringify(await recover(o.recover), null, 2)}\n`); return; }
  if (!file) throw new Error("usage: run.mjs <scenarios.json> [options]");
  const p = paths();
  if (o.dryRun) {
    const { summary } = await runScenarios({ scenarios: JSON.parse(readFileSync(file, "utf8")), opts: o, p });
    process.stdout.write(`GATE DRY RUN ${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  const stamp = stampNow();
  o.outDir ??= join(p.ctrl, "evals/gate", `run-${stamp}`);
  const { summary } = await runScenarios({ scenarios: JSON.parse(readFileSync(file, "utf8")), opts: { ...o, stamp } });
  process.stdout.write(`GATE RUN DONE ${JSON.stringify(summary)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { process.stderr.write(`run: ${e.message}\n`); process.exit(1); });
