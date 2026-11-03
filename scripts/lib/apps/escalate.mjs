// Closing an app until it is truly gone, and no further than that (Nick 2026-11-03: "i want them closed closed").
//   1. a normal quit (the app's own quit, so a save prompt can show), wait ~5 s and look at the process
//   2. SIGTERM to the app's own tree (its helpers, found by parent pid, bundle folder and bundle-id prefix), wait ~3 s
//   3. SIGKILL whatever is still there
// A document app that is still alive with a window after step 1 is asking to save: it is left alone and the reply says so.
// Everything goes through `src`, so tests run it with a stub process table and no clock.
export const GRACE_MS = 5000, TERM_MS = 3000, KILL_MS = 1000, STEP_MS = 250;
const names = (procs) => [...new Set(procs.map((p) => p.name))];

async function waitGone(src, pids, ms) {
  for (let t = 0; t < ms; t += STEP_MS) {
    if (!pids.some((p) => src.alive(p))) return true;
    await src.sleep(STEP_MS);
  }
  return !pids.some((p) => src.alive(p));
}

/** { name, state: closed | asking_to_save | still_open | not_running | left_alone, how: quit | term | kill, helpers: [name] } */
export async function closeApp(app, src, opts = {}) {
  const g = opts.graceMs ?? GRACE_MS, tm = opts.termMs ?? TERM_MS;
  if (!src.alive(app.pid)) return { name: app.name, state: "not_running", how: null, helpers: [] };
  const before = src.tree(app);                       // helpers named before the quit, so the ones left behind are still known after it
  src.quit(app);
  await waitGone(src, [app.pid], g);
  if (src.alive(app.pid) && app.document && src.windowCount(app) > 0) return { name: app.name, state: "asking_to_save", how: null, helpers: [] };
  const left = () => {
    const seen = new Map([...before, ...src.tree(app)].map((p) => [p.pid, p]));
    return [...seen.values()].filter((p) => src.alive(p.pid));
  };
  let rest = left();
  if (!rest.length) return { name: app.name, state: "closed", how: "quit", helpers: [] };
  if (src.ownsTree(rest)) return { name: app.name, state: "left_alone", how: null, helpers: [] };   // whoever is running this lives in that tree
  const helpers = names(rest.filter((p) => p.pid !== app.pid));
  rest.forEach((p) => src.signal(p.pid, "SIGTERM"));
  await waitGone(src, rest.map((p) => p.pid), tm);
  rest = left();
  if (!rest.length) return { name: app.name, state: "closed", how: "term", helpers };
  rest.forEach((p) => src.signal(p.pid, "SIGKILL"));
  await waitGone(src, rest.map((p) => p.pid), KILL_MS);
  const stuck = left();
  return { name: app.name, state: stuck.length ? "still_open" : "closed", how: "kill", helpers: [...new Set([...helpers, ...names(rest.filter((p) => p.pid !== app.pid))])] };
}
