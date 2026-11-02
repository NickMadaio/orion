// The mail watcher's pure parts (wave 14): reading a gog thread, scoring it, his rules, the model's answer, the alert line.
import test from "node:test";
import assert from "node:assert/strict";
import { mailItem, parseAddress, cleanSnippet } from "../scripts/lib/mail/normalize.mjs";
import { scoreMail, courseIn, knownPerson } from "../scripts/lib/mail/score.mjs";
import { addRule, kindOfValue, makeRule, prefVerdict, removeRule, emptyPrefs } from "../scripts/lib/mail/prefs.mjs";
import { parseMailAnswer, mailPrompt, askModel } from "../scripts/lib/mail/model.mjs";
import { alertLine, digestLine, planAlert, whoOf, ALERT_GAP_MS } from "../scripts/lib/mail/alert.mjs";
import { knowledgeContext } from "../scripts/lib/mail/context.mjs";

const NOW = new Date("2026-11-02T15:00:00Z");
const thread = ({ from, subject, snippet = "", labels = ["INBOX", "UNREAD"], unsubscribe = false, earlier = [], body = "SECRET BODY TEXT" }) => ({
  thread: { id: "t1", messages: [
    ...earlier.map((f, i) => ({ id: `m${i}`, headers: { from: f, subject }, body: "old" })),
    { id: "m-new", labelIds: labels, snippet, body, headers: { From: from, Subject: subject, ...(unsubscribe ? { "List-Unsubscribe": "<mailto:x@y>" } : {}) } },
  ] },
});
const item = (opts, ctx) => mailItem(thread(opts), ctx);
const CTX = { people: [{ name: "Jane Smith", role: "teacher" }, { name: "Priya Shah" }], courses: ["CS2100", "MKTG2201"] };

test("a thread becomes headers and snippet only: no body survives", () => {
  const it = item({ from: "\"Prof. Jane Smith\" <J.Smith@northeastern.edu>", subject: "CS2100 midterm", snippet: "Hi all, room change to &quot;West 110&quot; [url removed]" });
  assert.equal(it.fromName, "Prof. Jane Smith");
  assert.equal(it.fromAddress, "j.smith@northeastern.edu");
  assert.equal(it.domain, "northeastern.edu");
  assert.equal(it.snippet, "Hi all, room change to \"West 110\"");
  assert.equal(JSON.stringify(it).includes("SECRET"), false);
  assert.equal(it.messageId, "m-new");
});

test("Gmail's [{name,value}] header list is read too, and List-Unsubscribe is seen", () => {
  const it = mailItem({ id: "t9", messages: [{ id: "x", snippet: "50% off", payload: { headers: [{ name: "From", value: "Shop <deals@e.shop.com>" }, { name: "Subject", value: "Sale" }, { name: "List-Unsubscribe", value: "<u>" }] } }] });
  assert.equal(it.fromAddress, "deals@e.shop.com");
  assert.equal(it.listUnsubscribe, true);
});

test("parseAddress and cleanSnippet edge cases", () => {
  assert.deepEqual(parseAddress("sam@gmail.com"), { name: "", address: "sam@gmail.com" });
  assert.deepEqual(parseAddress("Sam via Canvas <notifications@instructure.com>"), { name: "Sam", address: "notifications@instructure.com" });
  assert.equal(cleanSnippet("a​​b  https://x.y/z  c"), "ab c");
});

test("a professor at his school about a course deadline is important; a same-day deadline is urgent", () => {
  const v = scoreMail(item({ from: "Prof. Jane Smith <j.smith@northeastern.edu>", subject: "CS2100 midterm", snippet: "Room change: the midterm is today at 3pm in West 110" }), CTX);
  assert.equal(v.level, "important");
  assert.equal(v.urgent, true);
  assert.ok(v.reasons.some((r) => /professor/.test(r)));
  assert.equal(v.topic, "CS2100");
});

test("newsletters, promotions and social notifications are skipped", () => {
  assert.equal(scoreMail(item({ from: "Zara <news@e.zara.com>", subject: "New arrivals: 30% off today", unsubscribe: true, labels: ["CATEGORY_PROMOTIONS"] }), CTX).level, "skip");
  assert.equal(scoreMail(item({ from: "LinkedIn <messages-noreply@linkedin.com>", subject: "You appeared in 9 searches this week" }), CTX).level, "skip");
  assert.equal(scoreMail(item({ from: "The Hustle <hello@thehustle.co>", subject: "Weekly digest", unsubscribe: true }), CTX).level, "skip");
});

test("a person he knows, a reply in his own thread, money and security codes all raise it", () => {
  assert.equal(scoreMail(item({ from: "Priya Shah <priya.s@gmail.com>", subject: "lab tmrw?" }), CTX).level, "important");
  const reply = item({ from: "Recruiter Bob <bob@acme.io>", subject: "Re: internship", earlier: ["Nick <nmadaio08@gmail.com>"] }, { nickAddresses: ["nmadaio08@gmail.com"] });
  assert.equal(reply.nickInThread, true);
  assert.equal(scoreMail(reply, CTX).level, "important");
  const code = scoreMail(item({ from: "Barclays <no-reply@barclays.co.uk>", subject: "Your security code", snippet: "Your one-time passcode is 123456" }), CTX);
  assert.equal(code.level, "important");
  assert.equal(code.urgent, true);
  assert.equal(scoreMail(item({ from: "Thames Water <billing@thameswater.co.uk>", subject: "Your bill is ready", snippet: "Payment due 10 Nov" }), CTX).level !== "skip", true);
});

test("an unknown person with nothing else is borderline (the model's case)", () => {
  const v = scoreMail(item({ from: "Alex Turner <alex.t@gmail.com>", subject: "hey", snippet: "long time no see" }), CTX);
  assert.equal(v.level, "borderline");
});

test("his rules decide first: a mute beats every signal, a boost beats a mute", () => {
  const prof = item({ from: "Prof. Jane Smith <j.smith@northeastern.edu>", subject: "CS2100 reading", snippet: "optional reading" });
  const muted = addRule(emptyPrefs(), makeRule({ action: "mute", kind: "topic", value: "optional reading", now: NOW }));
  assert.equal(scoreMail(prof, { ...CTX, prefs: muted }).level, "skip");
  const both = addRule(muted, makeRule({ action: "boost", kind: "sender", value: "smith", now: NOW }));
  assert.equal(scoreMail(prof, { ...CTX, prefs: both }).level, "important");
  const promo = item({ from: "Nike <news@e.nike.com>", subject: "Drop alert", unsubscribe: true });
  assert.equal(scoreMail(promo, { ...CTX, prefs: addRule(emptyPrefs(), makeRule({ action: "boost", kind: "domain", value: "nike.com", now: NOW })) }).level, "important");
});

test("prefs: kinds from values, the opposite rule replaces, remove by id or value", () => {
  assert.equal(kindOfValue("sam@gmail.com"), "sender");
  assert.equal(kindOfValue("linkedin.com"), "domain");
  assert.equal(kindOfValue("job alerts"), "topic");
  let p = addRule(emptyPrefs(), makeRule({ action: "mute", kind: "domain", value: "LinkedIn.com", now: NOW }));
  p = addRule(p, makeRule({ action: "mute", kind: "domain", value: "linkedin.com", now: NOW }));
  assert.equal(p.rules.length, 1);
  p = addRule(p, makeRule({ action: "boost", kind: "domain", value: "linkedin.com", now: NOW }));
  assert.deepEqual(p.rules.map((r) => r.action), ["boost"]);
  assert.equal(removeRule(p, "linkedin.com").removed, 1);
  assert.equal(removeRule(p, p.rules[0].id).removed, 1);
  assert.throws(() => makeRule({ action: "hide", kind: "topic", value: "x y" }), /action/);
  const it = item({ from: "Jobs <jobs@e.indeed.com>", subject: "New job alerts for you" });
  assert.equal(prefVerdict(addRule(emptyPrefs(), makeRule({ action: "mute", kind: "domain", value: "indeed.com" })), it)?.action, "mute");
});

test("the model's answer must be exact JSON; anything else is no opinion", async () => {
  assert.deepEqual(parseMailAnswer('{"important": true, "why": "from his TA"}'), { important: true, why: "from his TA" });
  assert.equal(parseMailAnswer("important"), null);
  assert.equal(parseMailAnswer('{"important": "yes"}'), null);
  const it = item({ from: "Alex <alex@gmail.com>", subject: "hey" });
  assert.match(mailPrompt(it, { prefs: addRule(emptyPrefs(), makeRule({ action: "mute", kind: "topic", value: "job alerts" })) }), /not important: topic job alerts/);
  const ok = await askModel(it, { fetchImpl: async (url, init) => { const b = JSON.parse(init.body); assert.equal(b.format, "json"); assert.equal(b.model, "qwen3.5:4b-q4_K_M"); return { ok: true, json: async () => ({ response: '{"important": false, "why": "chat"}' }) }; } });
  assert.deepEqual(ok, { important: false, why: "chat" });
  assert.equal(await askModel(it, { fetchImpl: async () => { throw new Error("ECONNREFUSED"); } }), null);
  assert.equal(await askModel(it, { timeoutMs: 20, fetchImpl: (u, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted")))) }), null);
});

test("alert lines read like a person said them, with no raw tool text", () => {
  const prof = item({ from: "\"Prof. Jane Smith\" <j.smith@northeastern.edu>", subject: "CS2100 Midterm", snippet: "Hi all, room change to West 110 for Thursday's midterm, please arrive early" });
  assert.equal(alertLine(prof), "Prof. Smith emailed about the CS2100 Midterm — 'room change to West 110 for Thursday's midterm, please arrive early'");
  assert.equal(whoOf(item({ from: "no-reply@accounts.barclays.co.uk", subject: "x" })), "Barclays");
  assert.equal(alertLine(item({ from: "Barclays <no-reply@barclays.co.uk>", subject: "Your security code", snippet: "Your one-time passcode is 482913" })), "Barclays emailed about your security code");
  const line = digestLine([prof, item({ from: "Sam Lee <sam@gmail.com>", subject: "Re: Fwd: friday?" }), item({ from: "Barclays <no-reply@barclays.co.uk>", subject: "Payment due" })]);
  assert.equal(line, "3 emails worth a look: Prof. Smith about the CS2100 Midterm; Sam Lee about friday; Barclays about payment due.");
  assert.doesNotMatch(line, /@|thread|url removed|https?:/);
});

test("spacing: one alert per 30 min, urgent goes now with whatever waits, stale waiting mail is dropped", () => {
  const a = { messageId: "a", urgent: false, foundAt: NOW.toISOString() };
  const b = { messageId: "b", urgent: true, foundAt: NOW.toISOString() };
  const recent = new Date(NOW.getTime() - 10 * 60_000).toISOString();
  assert.deepEqual(planAlert({ fresh: [a], lastAlertAt: recent, now: NOW }).keep.map((x) => x.messageId), ["a"]);
  assert.deepEqual(planAlert({ queue: [a], fresh: [b], lastAlertAt: recent, now: NOW }).send.map((x) => x.messageId), ["b", "a"]);
  assert.deepEqual(planAlert({ queue: [a], lastAlertAt: new Date(NOW.getTime() - ALERT_GAP_MS).toISOString(), now: NOW }).send.map((x) => x.messageId), ["a"]);
  const old = { ...a, foundAt: new Date(NOW.getTime() - 13 * 3600_000).toISOString() };
  assert.equal(planAlert({ queue: [old], now: NOW }).send.length, 0);
});

test("knowledge context: people, teachers named on a course, course codes", () => {
  const ctx = knowledgeContext({ nodes: [
    { id: "person:self", type: "person", label: "Nick", facts: [] },
    { id: "person:priya", type: "person", label: "Priya Shah", facts: [{ text: "DS lab partner" }] },
    { id: "person:okafor", type: "person", label: "Dr Okafor", subtitle: "ECON lecturer", facts: [] },
    { id: "course:cs2100", type: "course", label: "CS2100", facts: [{ text: "Taught by Prof. Jane Smith on Mondays" }] },
    { id: "course:x", type: "course", label: "Marketing", facts: [] },
  ] });
  assert.deepEqual(ctx.courses, ["CS2100"]);
  assert.ok(ctx.people.some((p) => p.name === "Jane Smith" && p.role === "teacher"));
  assert.ok(ctx.people.some((p) => p.name === "Dr Okafor" && p.role === "teacher"));
  assert.equal(ctx.people.some((p) => p.name === "Nick"), false);
  assert.equal(knownPerson({ fromName: "Jane Smith", fromAddress: "js@x.edu" }, ctx.people)?.name, "Jane Smith");
  assert.equal(courseIn({ subject: "cs 2100 hw", snippet: "" }, ctx.courses), "CS2100");
  assert.deepEqual(knowledgeContext(null), { people: [], courses: [] });
});
