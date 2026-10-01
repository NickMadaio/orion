// Grades what ORION actually did to a sandbox day (2026-10-01).
//
// Nick: "when i say run tests on this i mean ask orion to do stuff like this …
// catch these issues before they even arise." A schedule evaluation sends ORION
// real messages and judges the calendar left behind, not the reply's claims.

const toMinute = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };
const norm = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const named = (blocks, title) => blocks.filter((b) => norm(b.title).includes(norm(title)));

/**
 * @param after   [{ title, start, end }] minutes, the sandbox day once ORION finished
 * @param before  the same shape, the day he started from
 * @param expect  { has, count, minutes, order, absent, unchanged, maxLength, minLength }
 * @param now     minute of day the scenario happens at
 * @param reply   ORION's final reply text
 * @returns { ok, failures: string[] }
 */
export function gradeSchedule({ after, before, expect = {}, now = 0, reply = "" }) {
  if (!Array.isArray(after) || !Array.isArray(before)) throw new TypeError("after and before must be arrays");
  const failures = [];
  const ahead = after.filter((b) => b.end > now);
  for (const [i, a] of ahead.entries()) {
    for (const b of ahead.slice(i + 1)) {
      if (a.start < b.end && b.start < a.end) failures.push(`overlap: ${a.title} ${a.start}-${a.end} and ${b.title} ${b.start}-${b.end}`);
    }
  }
  // Nothing he had is silently duplicated.
  const titles = new Map();
  for (const b of after) titles.set(norm(b.title), (titles.get(norm(b.title)) ?? 0) + 1);
  for (const [title, n] of titles) {
    const was = before.filter((b) => norm(b.title) === title).length;
    if (n > Math.max(1, was)) failures.push(`duplicate: ${n} × "${title}"`);
  }
  for (const h of expect.has ?? []) {
    const match = named(after, h.title);
    if (!match.length) { failures.push(`missing: ${h.title}`); continue; }
    const ok = match.some((b) => (h.start === undefined || b.start === toMinute(h.start))
      && (h.end === undefined || b.end === toMinute(h.end))
      && (h.startAtLeast === undefined || b.start >= toMinute(h.startAtLeast))
      && (h.startBefore === undefined || b.start < toMinute(h.startBefore))
      && (h.endAtLeast === undefined || b.end >= toMinute(h.endAtLeast))
      && (h.endBefore === undefined || b.end < toMinute(h.endBefore)));
    if (!ok) failures.push(`wrong time: ${h.title} is ${match.map((b) => `${b.start}-${b.end}`).join(", ")}, wanted ${JSON.stringify(h)}`);
  }
  for (const [title, n] of Object.entries(expect.count ?? {})) {
    if (named(after, title).length !== n) failures.push(`count: ${named(after, title).length} × "${title}", wanted ${n}`);
  }
  for (const [title, minutes] of Object.entries(expect.minutes ?? {})) {
    const b = named(after, title)[0];
    if (!b || b.end - b.start !== minutes) failures.push(`length: ${title} is ${b ? b.end - b.start : "gone"}, wanted ${minutes}`);
  }
  for (const [title, minutes] of Object.entries(expect.minLength ?? {})) {
    const b = named(after, title)[0];
    if (!b || b.end - b.start < minutes) failures.push(`too short: ${title} is ${b ? b.end - b.start : "gone"}, wanted at least ${minutes}`);
  }
  for (const [title, minutes] of Object.entries(expect.maxLength ?? {})) {
    const b = named(after, title)[0];
    if (!b || b.end - b.start > minutes) failures.push(`too long: ${title} is ${b ? b.end - b.start : "gone"}, wanted at most ${minutes}`);
  }
  for (const [first, second] of expect.order ?? []) {
    const a = named(after, first)[0]; const b = named(after, second)[0];
    if (!a || !b || a.start >= b.start) failures.push(`order: ${first} should come before ${second}`);
  }
  for (const title of expect.absent ?? []) if (named(after, title).length) failures.push(`still there: ${title}`);
  for (const title of expect.unchanged ?? []) {
    const a = named(after, title)[0]; const b = named(before, title)[0];
    if (!a || !b || a.end - a.start !== b.end - b.start) failures.push(`changed length: ${title}`);
  }
  // Untouched work he did not mention keeps existing.
  for (const b of before.filter((x) => x.end > now)) {
    const mentioned = [...(expect.absent ?? []), ...(expect.mayDrop ?? [])].some((t) => norm(b.title).includes(norm(t)));
    if (!mentioned && !named(after, b.title).length && !(expect.renamed ?? []).some((t) => norm(b.title).includes(norm(t)))) failures.push(`lost: ${b.title}`);
  }
  if (/\bnoted\b/i.test(reply) && !/saved/i.test(reply)) failures.push('reply says "noted" without saying it was saved');
  return { ok: failures.length === 0, failures };
}
