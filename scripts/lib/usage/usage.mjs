// ORION's model usage and cost (2026-10-07): every model call, Claude and local,
// from OpenClaw's trajectories plus ORION's own direct local calls. Pure: rows
// in, a report out. scripts/orion-usage does the files.

// $ per million tokens. Writes: 5-minute ("short") or 1-hour ("long") cache.
export const PRICES = {
  "claude-haiku-4-5": { input: 1, output: 5, read: 0.1, writeShort: 1.25, writeLong: 2 },
  "claude-sonnet-5": { input: 2, output: 10, read: 0.2, writeShort: 2.5, writeLong: 4 },
  "claude-sonnet-5-5": { input: 2, output: 10, read: 0.2, writeShort: 2.5, writeLong: 4 },
  "claude-opus-5-5": { input: 4, output: 20, read: 0.2, writeShort: 5, writeLong: 8 },
};

export function priceFor(model) {
  const key = Object.keys(PRICES).sort((a, b) => b.length - a.length).find((k) => String(model).startsWith(k));
  return key ? PRICES[key] : null;
}

/** One model call → { at, model, local, source, input, output, cacheRead, cacheWrite, cost }. */
export function rowFromTrajectory(event) {
  if (!event || event.type !== "model.completed") return null;
  const usage = event.data?.usage ?? {};
  const model = event.modelId ?? "unknown";
  const local = event.provider === "ollama" || !priceFor(model);
  const long = event.data?.promptCache?.retention === "long";
  const p = priceFor(model);
  const n = (k) => Number(usage[k]) || 0;
  const cost = p ? (n("input") * p.input + n("output") * p.output + n("cacheRead") * p.read
    + n("cacheWrite") * (long ? p.writeLong : p.writeShort)) / 1e6 : 0;
  return { at: event.ts, model, local, source: sourceOf(event.sessionKey), input: n("input"), output: n("output"),
    cacheRead: n("cacheRead"), cacheWrite: n("cacheWrite"), cost };
}

/** Where a call came from, by its session key. */
export function sourceOf(sessionKey = "") {
  const k = String(sessionKey);
  if (/orion-eval|eval-sched/.test(k)) return "tests";
  if (/claude-|probe|bench/.test(k)) return "checks";
  if (/orion-chat/.test(k)) return "mac chat";
  if (/orion-app|remote|phone/.test(k)) return "phone";
  if (/discord/.test(k)) return "discord";
  if (/cron|standing|heartbeat|morning|evening/.test(k)) return "background";
  return "mac voice";
}

const add = (bucket, r) => {
  for (const k of ["input", "output", "cacheRead", "cacheWrite", "cost"]) bucket[k] = (bucket[k] ?? 0) + r[k];
  bucket.calls = (bucket.calls ?? 0) + 1;
  return bucket;
};
const empty = () => ({ calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });

function period(rows) {
  const byModel = {}, bySource = {};
  const total = empty();
  for (const r of rows) {
    add(total, r);
    byModel[r.model] = add(byModel[r.model] ?? { ...empty(), local: r.local }, r);
    bySource[r.source] = add(bySource[r.source] ?? empty(), r);
  }
  return { ...total, byModel, bySource };
}

/** The whole report. `now` is a Date; days are local calendar days. */
export function report(rows, { now, budget = 15 } = {}) {
  if (!(now instanceof Date)) throw new TypeError("now must be a Date");
  const day = (d) => new Date(d).toLocaleDateString("en-CA");
  const today = day(now);
  const weekAgo = new Date(now.getTime() - 6 * 86400000); weekAgo.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const inRange = (from) => rows.filter((r) => new Date(r.at) >= from);
  const month = period(inRange(monthStart));
  const daysSoFar = Math.max(1, (now - monthStart) / 86400000);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  // Projection from real use only: tests and my checks are not what a normal month costs.
  const realMonth = month.cost - (month.bySource.tests?.cost ?? 0) - (month.bySource.checks?.cost ?? 0);
  const daily = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000); const key = day(d);
    const list = rows.filter((r) => day(r.at) === key);
    daily.push({ day: key, cost: list.reduce((a, r) => a + r.cost, 0), localCalls: list.filter((r) => r.local).length });
  }
  return {
    generatedAt: now.toISOString(), budget,
    today: period(rows.filter((r) => day(r.at) === today)),
    week: period(inRange(weekAgo)),
    month,
    projection: { monthReal: realMonth / daysSoFar * daysInMonth, monthAll: month.cost / daysSoFar * daysInMonth },
    daily,
  };
}
