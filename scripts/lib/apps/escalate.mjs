// Closing an app until it is truly gone, and no further than that (Nick 2026-11-03: "i want them closed closed").
//   1. a normal quit (the app's own quit, so a save prompt can show), wait ~5 s and look at the process
//   2. SIGTERM to the app's own tree (its helpers, found by parent pid, bundle folder and bundle-id prefix), wait ~3 s
//   3. SIGKILL whatever is still there
// An app still alive with a visible window after step 1 is asking something (a save prompt, "quit anyway?"): it is left alone and the reply
// says so. Only launchers, game clients, chat and music apps (policy.isBackgroundClass) go all the way automatically.
// Every process in the tree is recorded as { pid, comm, start } before the quit; before each signal it is looked up again and signalled only
// if the same program started at the same time still holds that pid (pids are reused), and never when the tree holds whoever runs this.
// Everything goes through `src`, so tests run it with a stub process table and no clock.
import { isBackgroundClass } from "./policy.mjs";

export const GRACE_MS = 5000, TERM_MS = 3000, KILL_MS = 1000, STEP_MS = 250;
const names = (procs) => [...new Set(procs.map((p) => p.name))];

async function waitGone(src, pids, ms) {
  for (let t = 0; t < ms; t += STEP_MS) {
    if (!pids.some((p) => src.alive(p))) return true;
    await src.sleep(STEP_MS);
  }
  return !pids.some((p) => src.alive(p));
}

/** The processes still running that are the same ones recorded (same pid, program and start time). */
const ours = (src, procs) => procs.filter((p) => { const now = src.identity(p.pid); return now && now.comm === p.comm && now.start === p.start; });

/** { name, state: closed | asking_to_save | still_open | not_running | left_alone, how: quit | term | kill, helpers: [name] } */
export async function closeApp(app, src, opts = {}) {
  const g = opts.graceMs ?? GRACE_MS, tm = opts.termMs ?? TERM_MS;
  const result = (state, how = null, helpers = [], procs = 0) => ({ name: app.name, state, how, helpers, document: !!app.document, ...(procs ? { helperProcs: procs } : {}) });
  if (!src.alive(app.pid)) return result("not_running");
  const before = src.tree(app);                       // recorded before the quit: helpers left behind are still known, and still checked, after it
  if (src.ownsTree(before)) return result("left_alone");   // whoever runs this lives in that tree: not even the normal quit
  src.quit(app);
  await waitGone(src, [app.pid], g);
  if (src.alive(app.pid) && src.windowCount(app) > 0 && !isBackgroundClass(app)) return result("asking_to_save");
  const left = () => {
    const seen = new Map([...before, ...src.tree(app)].map((p) => [p.pid, p]));
    return ours(src, [...seen.values()]).filter((p) => src.alive(p.pid));
  };
  let rest = left();
  if (!rest.length) return result("closed", "quit");
  const helpers = names(rest.filter((p) => p.pid !== app.pid));
  const procs = rest.filter((p) => p.pid !== app.pid).length;   // helper processes, not names: "4 helpers" counts all four
  ours(src, rest).forEach((p) => src.signal(p.pid, "SIGTERM"));
  await waitGone(src, rest.map((p) => p.pid), tm);
  rest = left();
  if (!rest.length) return result("closed", "term", helpers, procs);
  ours(src, rest).forEach((p) => src.signal(p.pid, "SIGKILL"));
  await waitGone(src, rest.map((p) => p.pid), KILL_MS);
  const stuck = left();
  return result(stuck.length ? "still_open" : "closed", "kill", [...new Set([...helpers, ...names(rest.filter((p) => p.pid !== app.pid))])], Math.max(procs, rest.filter((p) => p.pid !== app.pid).length));
}
