// One watchdog pass with every side effect injected:
// deps = { fetch, run(cmd,args), readState(), writeState(s), now(), uid, notify(event, text) }
import { RELAUNCH } from "./config.mjs";
import { normalise, step } from "./machine.mjs";
import { probeAll } from "./probes.mjs";
import { warmAll } from "./warm.mjs";

const LABEL = { ollama: "Ollama", app: "The Orion app", link: "The phone link", gateway: "The gateway" };
const sub = (args, uid) => args.map((a) => a.replace("{uid}", String(uid)));
const msg = (error) => String(error?.message ?? error).slice(0, 100);

export function alertText(alert, now) {
  const mins = Math.max(1, Math.round((now - alert.since) / 60_000));
  return alert.type === "down"
    ? `${LABEL[alert.component]} has been down for ${mins} min and is not back yet. The watchdog keeps retrying.`
    : `${LABEL[alert.component]} is back after ${mins} min.`;
}

export async function runPass(deps, { dryRun = false } = {}) {
  const now = deps.now();
  const run = (cmd, args) => deps.run(cmd, sub(args, deps.uid));
  const probes = await probeAll({ fetch: deps.fetch, run });
  const prev = normalise(await deps.readState());
  const { state, actions, alerts } = step(prev, probes, now);

  const report = { at: new Date(now).toISOString(), dryRun, probes, actions, alerts, warm: null, errors: [] };
  if (dryRun) return { ...report, state };

  let next = state;
  for (const action of actions) {
    if (action.type === "relaunch") {
      const spec = RELAUNCH[action.component];
      try {
        const res = await run(spec.cmd, spec.args);
        if (res.code !== 0) report.errors.push(`${action.component}: relaunch exited ${res.code}`);
      } catch (error) {
        report.errors.push(`${action.component}: ${msg(error)}`);
      }
    } else if (action.type === "warm") {
      report.warm = await warmAll(deps.fetch);
      if (report.warm.every((r) => r.ok)) next = { ...next, pendingWarm: false };
    }
  }
  for (const alert of alerts) {
    try {
      await deps.notify(alert.type === "down" ? "blocked" : "complete", alertText(alert, now));
    } catch (error) {
      report.errors.push(`alert: ${msg(error)}`);
    }
  }
  await deps.writeState(next);
  return { ...report, state: next };
}
