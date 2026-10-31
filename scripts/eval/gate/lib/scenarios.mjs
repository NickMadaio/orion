// Scenario file schema, validation, and the regex half of grading (the rubric half is a separate grader's job).
//   [{ id, area, wording: "vague"|"clear", pair, writes: bool, setup: { now?, state?, calendar?: { now, events, reminders? }, live? },
//      turns: [{ text, spoken?, replyToOutreach? }],
//      expect: { rubric, reply_must?: [regex], reply_must_not?: [regex], effect?: { kind, detail } } }]
export function validateScenarios(list) {
  const errors = [];
  if (!Array.isArray(list)) return ["scenario file must be a JSON array"];
  const ids = new Set();
  list.forEach((s, i) => {
    const at = `item ${i}${s?.id ? ` (${s.id})` : ""}`;
    const bad = (m) => errors.push(`${at}: ${m}`);
    if (!s || typeof s !== "object") return bad("not an object");
    if (typeof s.id !== "string" || !/^[A-Za-z0-9._-]+$/.test(s.id)) bad("id must match [A-Za-z0-9._-]+");
    else if (ids.has(s.id)) bad("duplicate id"); else ids.add(s.id);
    if (typeof s.area !== "string" || !s.area) bad("area is required");
    if (!["vague", "clear"].includes(s.wording)) bad('wording must be "vague" or "clear"');
    if (typeof s.writes !== "boolean") bad("writes must be true or false (it decides whether --readonly runs the item)");
    if (!Array.isArray(s.turns) || s.turns.length === 0) bad("turns must be a non-empty array");
    else s.turns.forEach((t, j) => { if (typeof t?.text !== "string" || !t.text.trim()) bad(`turns[${j}].text is required`); });
    if (!s.expect || typeof s.expect.rubric !== "string") bad("expect.rubric is required");
    for (const k of ["reply_must", "reply_must_not"]) {
      for (const pat of s.expect?.[k] ?? []) { try { toRegex(pat); } catch (e) { bad(`${k} has an invalid regex ${JSON.stringify(pat)}: ${e.message}`); } }
    }
    if (s.setup?.state && (typeof s.setup.state !== "object" || Array.isArray(s.setup.state))) bad("setup.state must be an object of file name to JSON");
    validateSetupTiming(s, bad);
  });
  return errors;
}

const OWNED_KINDS = new Set(["gym", "study", "side_project", "class", "deadline", "rest", "nap", "other"]);
const isInstant = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const TOKENISH = /\{\{[^}]*\}\}/g;
const VALID_TOKEN = /^\{\{\s*(now\s*(?:[+-]\s*\d+\s*[mh])?|(?:today|tomorrow)\s+\d{1,2}:\d{2})\s*\}\}$/;

/** setup.calendar (the sandbox day), setup.live (real calendar, real time) and the {{…}} tokens only live items may use. */
function validateSetupTiming(s, bad) {
  const setup = s.setup ?? {};
  if (setup.live !== undefined && typeof setup.live !== "boolean") bad("setup.live must be true or false");
  if (setup.live === true && setup.calendar) bad("setup.live and setup.calendar exclude each other: a live item runs on the real calendar");
  if (setup.live === true && setup.now) bad("setup.live runs at the real time: drop setup.now and use {{now+Nm}} tokens");
  const c = setup.calendar;
  if (c !== undefined) {
    if (!c || typeof c !== "object" || Array.isArray(c)) bad("setup.calendar must be an object { now, events, reminders? }");
    else {
      if (!isInstant(c.now)) bad("setup.calendar.now must be an ISO instant with a zone");
      if (setup.now && setup.now !== c.now) bad("setup.now and setup.calendar.now disagree");
      if (!Array.isArray(c.events)) bad("setup.calendar.events must be an array");
      else c.events.forEach((e, j) => {
        if (typeof e?.title !== "string" || !e.title.trim()) bad(`setup.calendar.events[${j}].title is required`);
        if (!isInstant(e?.start) || !isInstant(e?.end)) bad(`setup.calendar.events[${j}] needs ISO start and end`);
        else if (Date.parse(e.end) <= Date.parse(e.start)) bad(`setup.calendar.events[${j}] ends before it starts`);
        if (e?.owned !== undefined && !OWNED_KINDS.has(e.owned)) bad(`setup.calendar.events[${j}].owned must be one of ${[...OWNED_KINDS].join(", ")}`);
      });
      if (c.reminders !== undefined && (!Array.isArray(c.reminders) || c.reminders.some((r) => typeof r?.title !== "string" || (r.due !== undefined && !isInstant(r.due)))))
        bad("setup.calendar.reminders must be [{ title, due?: ISO }]");
    }
  }
  (Array.isArray(s.turns) ? s.turns : []).forEach((t, j) => {
    const tokens = typeof t?.text === "string" ? t.text.match(TOKENISH) ?? [] : [];
    if (!tokens.length) return;
    if (setup.live !== true) bad(`turns[${j}] has time tokens but the item is not setup.live`);
    for (const tok of tokens) if (!VALID_TOKEN.test(tok)) bad(`turns[${j}] has an invalid token ${tok}`);
  });
}

/** "/foo/gi" or plain "foo" (case-insensitive). */
export function toRegex(pattern) {
  const m = /^\/(.*)\/([a-z]*)$/s.exec(pattern);
  return m ? new RegExp(m[1], m[2].replace("g", "")) : new RegExp(pattern, "i");
}

/** reply_must is checked against the LAST turn's reply; reply_must_not against every turn's. */
export function checkReplies(expect, replies) {
  const last = replies.at(-1) ?? "";
  const must = (expect.reply_must ?? []).map((pattern) => ({ pattern, pass: toRegex(pattern).test(last) }));
  const mustNot = (expect.reply_must_not ?? []).map((pattern) => ({ pattern, pass: !replies.some((r) => toRegex(pattern).test(r ?? "")) }));
  return { reply_must: must, reply_must_not: mustNot, passed: [...must, ...mustNot].every((c) => c.pass), hasRegex: must.length + mustNot.length > 0 };
}

export function summarize(results) {
  const ran = results.filter((r) => !r.skipped);
  const graded = ran.filter((r) => r.checks?.hasRegex);
  const group = (key) => Object.fromEntries([...new Set(graded.map((r) => r[key]))].map((k) => {
    const rs = graded.filter((r) => r[key] === k);
    return [k, { pass: rs.filter((r) => r.checks.passed).length, fail: rs.filter((r) => !r.checks.passed).length }];
  }));
  const lat = ran.flatMap((r) => r.turns.map((t) => t.latencyMs)).filter((n) => Number.isFinite(n));
  return {
    items: results.length, ran: ran.length, skipped: results.length - ran.length,
    regex: { graded: graded.length, pass: graded.filter((r) => r.checks.passed).length, fail: graded.filter((r) => !r.checks.passed).length, failing: graded.filter((r) => !r.checks.passed).map((r) => r.id) },
    byArea: group("area"), byWording: group("wording"),
    turnErrors: ran.filter((r) => r.turns.some((t) => !t.reply)).map((r) => r.id),
    restoreFailures: ran.filter((r) => r.cleanup && !r.cleanup.verified.ok).map((r) => ({ id: r.id, problems: r.cleanup.verified.problems })),
    changedState: ran.filter((r) => r.effect?.changedAnything).map((r) => r.id),
    latencyMs: lat.length ? { mean: Math.round(lat.reduce((a, b) => a + b, 0) / lat.length), max: Math.max(...lat) } : null,
  };
}
