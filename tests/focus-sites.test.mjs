import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BLOCKED, brandOf, decideDomain, domainMatches, guardStep, initialGuard, nudgeLine, normalizeDomain, resolveSiteName } from "../scripts/lib/focus/sites.mjs";
import { backPageHtml, redirectScript, runTick, readWeb, writeWeb, webFile, newWeb, withOverride, withApps } from "../scripts/lib/focus/guard.mjs";

const T0 = Date.parse("2026-11-04T18:00:00Z");
const SAFARI = "com.apple.Safari";

// --- the decision table ----------------------------------------------------------------------------------------------
test("domain decision table: override > allowed > blocked > unlisted", () => {
  const allowed = ["docs.google.com", "github.com"];
  const cases = [
    [{ domain: "youtube.com" }, "block"],
    [{ domain: "www.youtube.com" }, "block"],
    [{ domain: "m.youtube.com" }, "block"],
    [{ domain: "youtu.be" }, "block"],
    [{ domain: "old.reddit.com" }, "block"],
    [{ domain: "x.com" }, "block"],
    [{ domain: "twitch.tv" }, "block"],
    [{ domain: "netflix.com" }, "block"],
    [{ domain: "tiktok.com" }, "block"],
    [{ domain: "instagram.com" }, "block"],
    [{ domain: "docs.google.com", allowed }, "allow"],
    [{ domain: "github.com", allowed }, "allow"],
    [{ domain: "gist.github.com", allowed }, "allow"],
    [{ domain: "stackoverflow.com", allowed }, "allow"],       // not listed anywhere: not policed
    [{ domain: "notyoutube.com" }, "allow"],                    // suffix trap
    [{ domain: "youtube.com.evil.example" }, "allow"],          // prefix trap
    [{ domain: "youtube.com", allowed: ["youtube.com"] }, "allow"],   // a task that really needs it (video editing)
    [{ domain: "youtube.com", overrides: ["youtube.com"] }, "allow"], // "i need youtube for this"
    [{ domain: "reddit.com", overrides: ["youtube.com"] }, "block"],  // an override is for that site only
    [{ domain: null }, "allow"],
    [{ domain: "" }, "allow"],
    [{ domain: "localhost" }, "allow"],
  ];
  for (const [input, want] of cases) assert.equal(decideDomain(input), want, JSON.stringify(input));
});

test("the blocked list covers the usual suspects", () => {
  for (const d of ["youtube.com", "reddit.com", "tiktok.com", "instagram.com", "netflix.com", "twitch.tv", "x.com"]) assert.ok(BLOCKED.includes(d), d);
});

test("domains normalise from urls and www", () => {
  assert.equal(normalizeDomain("https://www.YouTube.com/watch?v=1"), "youtube.com");
  assert.equal(normalizeDomain("www.reddit.com"), "reddit.com");
  assert.equal(normalizeDomain("not a host"), null);
  assert.ok(domainMatches("a.b.github.com", "github.com"));
  assert.equal(brandOf("m.youtube.com"), "YouTube");
  assert.equal(nudgeLine("www.youtube.com"), "YouTube isn't part of this session.");
});

test("a site named in words resolves to its domain", () => {
  assert.equal(resolveSiteName("youtube"), "youtube.com");
  assert.equal(resolveSiteName("YouTube"), "youtube.com");
  assert.equal(resolveSiteName("reddit"), "reddit.com");
  assert.equal(resolveSiteName("twitter"), "twitter.com");
  assert.equal(resolveSiteName("netflix.com"), "netflix.com");
  assert.equal(resolveSiteName("https://www.twitch.tv/x"), "twitch.tv");
  assert.equal(resolveSiteName("two words"), null);
});

// --- the guard step ----------------------------------------------------------------------------------------------------
const tick = (state, over = {}, dt = 0) => guardStep(state, { nowMs: T0 + dt, active: true, activityAtMs: T0 + dt - 1000, bundleId: SAFARI, domain: "youtube.com", allowed: [], overrides: [], ...over });

test("first sight of a blocked site nudges once; 20 s later it redirects; not before", () => {
  let r = tick(initialGuard());
  assert.equal(r.action, "nudge");
  r = tick(r.state, {}, 5_000);
  assert.equal(r.action, "none");
  r = tick(r.state, {}, 19_000);
  assert.equal(r.action, "none");
  r = tick(r.state, {}, 20_000);
  assert.equal(r.action, "redirect");
  assert.equal(r.domain, "youtube.com");
});

test("leaving the site before the grace resets everything", () => {
  let r = tick(initialGuard());
  r = tick(r.state, { domain: "docs.google.com" }, 10_000);
  assert.equal(r.action, "none");
  r = tick(r.state, {}, 12_000);
  assert.equal(r.action, "nudge");   // a new visit gets its own quiet nudge
});

test("a break, a stale activity file, a non-browser app or a missing url never act", () => {
  assert.equal(tick(initialGuard(), { active: false }).action, "none");
  assert.equal(tick(initialGuard(), { activityAtMs: T0 - 120_000 }).action, "none");
  assert.equal(tick(initialGuard(), { bundleId: "com.apple.Pages" }).action, "none");
  assert.equal(tick(initialGuard(), { domain: null }).action, "none");
});

test("the allowed list and an override stop the guard", () => {
  assert.equal(tick(initialGuard(), { allowed: ["youtube.com"] }).action, "none");
  assert.equal(tick(initialGuard(), { overrides: ["youtube.com"] }).action, "none");
});

test("after a redirect, if he goes straight back it acts again only after another grace", () => {
  let r = tick(initialGuard());
  r = tick(r.state, {}, 20_000);
  assert.equal(r.action, "redirect");
  assert.equal(tick(r.state, {}, 30_000).action, "none");
  assert.equal(tick(r.state, {}, 41_000).action, "redirect");
});

test("with Automation denied the guard only nudges, and not more than once a minute", () => {
  let r = tick({ ...initialGuard(), deniedAt: T0 - 1 });
  assert.equal(r.action, "nudge");
  r = tick(r.state, {}, 25_000);
  assert.equal(r.action, "none");
  r = tick(r.state, {}, 61_000);
  assert.equal(r.action, "nudge");
  assert.notEqual(tick(r.state, {}, 90_000).action, "redirect");
});

test("guardStep never mutates the state it is given", () => {
  const s = initialGuard();
  const frozen = Object.freeze({ ...s });
  tick(frozen);
  assert.deepEqual(frozen, s);
});

// --- effects text, never run --------------------------------------------------------------------------------------------
test("redirect scripts per browser, with only safe characters in them", () => {
  const s = redirectScript(SAFARI, "youtube.com", "file:///x/focus-back.html");
  assert.equal(s.app, "Safari");
  assert.match(s.source, /URL of current tab of front window/);
  assert.match(s.source, /youtube\.com/);
  const c = redirectScript("com.google.Chrome", "reddit.com", "file:///x/focus-back.html");
  assert.match(c.source, /active tab of front window/);
  assert.equal(redirectScript("com.apple.Pages", "youtube.com", "file:///x"), null);
  assert.equal(redirectScript(SAFARI, 'x.com" & (do shell script "rm -rf ~") & "', "file:///x"), null);
  assert.equal(redirectScript(SAFARI, "x.com", 'file:///x" & quit'), null);
});

test("the calm page names the task and escapes it", () => {
  const html = backPageHtml("Finish <script>alert(1)</script> resume");
  assert.match(html, /Back to Finish &lt;script&gt;/);
  assert.ok(!html.includes("<script>"));
});

// --- runTick end to end with every effect stubbed ----------------------------------------------------------------------------
async function harness(t, { web = true, status = { status: "running", phase: "focus", remainingSeconds: 1500 }, activity } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "orion-sites-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  if (web) writeWeb(webFile(dir), newWeb({ task: "Finish resume", apps: [SAFARI], names: ["Safari"], domains: ["docs.google.com"], startedAt: new Date(T0 - 600_000).toISOString(), checkedAtMs: T0 }));
  if (activity) await writeFile(join(dir, "activity.json"), JSON.stringify(activity));
  const effects = { notified: [], redirected: [], statusCalls: 0, redirectResult: "ok", learned: [] };
  const deps = (nowMs) => ({ dir, nowMs,
    status: async () => { effects.statusCalls++; return status; },
    notify: async (line) => { effects.notified.push(line); },
    redirect: async (args) => { effects.redirected.push(args); return effects.redirectResult; },
    learn: async (task, from, to) => { effects.learned.push({ task, from, to }); } });
  return { dir, effects, deps };
}
const act = (dt, over = {}) => ({ version: 1, at: new Date(T0 + dt - 1000).toISOString(), idleSeconds: 1, app: { name: "Safari", bundleId: SAFARI }, category: "browser", url: "https://www.youtube.com/watch?v=1", domain: "youtube.com", siteCategory: "video", focus: { active: true }, ...over });

test("runTick: nudges, then redirects after the grace, and tells the redirect where he was", async (t) => {
  const h = await harness(t, { activity: act(0) });
  let r = await runTick(h.deps(T0));
  assert.equal(r.action, "nudge");
  assert.deepEqual(h.effects.notified, ["YouTube isn't part of this session."]);
  await writeFile(join(h.dir, "activity.json"), JSON.stringify(act(21_000)));
  r = await runTick(h.deps(T0 + 21_000));
  assert.equal(r.action, "redirect");
  assert.equal(h.effects.redirected.length, 1);
  assert.equal(h.effects.redirected[0].domain, "youtube.com");
  assert.equal(h.effects.redirected[0].bundleId, SAFARI);
  assert.equal(h.effects.redirected[0].task, "Finish resume");
});

test("runTick: a task-allowed site and a one-time override are left alone", async (t) => {
  const h = await harness(t, { activity: act(0, { domain: "docs.google.com", url: "https://docs.google.com/d/1" }) });
  assert.equal((await runTick(h.deps(T0))).action, "none");
  await writeFile(join(h.dir, "activity.json"), JSON.stringify(act(0)));
  const web = readWeb(webFile(h.dir));
  writeWeb(webFile(h.dir), withOverride(web, "youtube.com"));
  assert.equal((await runTick(h.deps(T0 + 30_000))).action, "none");
  assert.deepEqual(h.effects.notified, []);
});

test("runTick: no activity.json (the writer is another worker's) degrades to doing nothing", async (t) => {
  const h = await harness(t);
  const r = await runTick(h.deps(T0));
  assert.equal(r.action, "none");
  assert.deepEqual(h.effects.notified, []);
});

test("runTick: no focus web file means nothing to guard and no status call", async (t) => {
  const h = await harness(t, { web: false, activity: act(0) });
  assert.equal((await runTick(h.deps(T0))).action, "none");
  assert.equal(h.effects.statusCalls, 0);
});

test("runTick: on a break nothing is policed", async (t) => {
  const h = await harness(t, { activity: act(0), status: { status: "running", phase: "rest", remainingSeconds: 300 } });
  const r = await runTick(h.deps(T0 + 31_000));
  assert.equal(r.action, "none");
  assert.deepEqual(h.effects.notified, []);
});

test("runTick: denied Automation is remembered and only nudges", async (t) => {
  const h = await harness(t, { activity: act(0) });
  h.effects.redirectResult = "denied";
  await runTick(h.deps(T0));
  await writeFile(join(h.dir, "activity.json"), JSON.stringify(act(21_000)));
  let r = await runTick(h.deps(T0 + 21_000));
  assert.equal(r.action, "redirect");
  assert.equal(r.result, "denied");
  await writeFile(join(h.dir, "activity.json"), JSON.stringify(act(50_000)));
  r = await runTick(h.deps(T0 + 50_000));
  assert.equal(h.effects.redirected.length, 1);   // no second attempt at a tab it may not touch
});

test("runTick: when the session is over it learns what he used, clears the guard and stops", async (t) => {
  const h = await harness(t, { activity: act(0), status: { status: "none" } });
  const r = await runTick(h.deps(T0 + 31_000));
  assert.equal(r.action, "finalized");
  assert.equal(h.effects.learned.length, 1);
  assert.equal(h.effects.learned[0].task, "Finish resume");
  assert.equal(readWeb(webFile(h.dir))?.active ?? false, false);
  assert.deepEqual(h.effects.notified, []);
});

test("runTick: status is read at most every 30 s, and the phase end is kept fresh", async (t) => {
  const h = await harness(t, { activity: act(0, { domain: "github.com" }) });
  await runTick(h.deps(T0 + 5_000));
  assert.equal(h.effects.statusCalls, 0);
  await runTick(h.deps(T0 + 31_000));
  assert.equal(h.effects.statusCalls, 1);
  const web = readWeb(webFile(h.dir));
  assert.equal(web.phase, "focus");
  assert.equal(Date.parse(web.phaseEnd), T0 + 31_000 + 1500_000);
});

test("web state: apps and overrides are added without mutating", () => {
  const a = newWeb({ task: "x", apps: [SAFARI], names: ["Safari"], domains: ["a.com"], startedAt: "2026-11-04T18:00:00Z" });
  const b = withApps(a, [{ bundleId: "com.apple.Pages", name: "Pages" }]);
  const c = withOverride(b, "https://www.youtube.com/x");
  assert.deepEqual(a.allowedApps, [SAFARI]);
  assert.deepEqual(b.allowedApps, [SAFARI, "com.apple.Pages"]);
  assert.deepEqual(b.allowedAppNames, ["Safari", "Pages"]);
  assert.deepEqual(c.overrides, ["youtube.com"]);
  assert.equal(c.active, true);
});

test("the cli never touches a browser when asked for a dry run, and allow/show work on a temp dir", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "orion-sites-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const env = { ...process.env, ORION_CONTROLLED_DIR: dir, ORION_SESSION_SOCKET: join(dir, "none.sock") };
  const run = (...a) => spawnSync(process.execPath, ["scripts/orion-focus-sites", ...a], { encoding: "utf8", env });
  assert.equal(JSON.parse(run("show", "--json").stdout).active, false);
  assert.equal(run("set", "--task", "Finish resume", "--apps", SAFARI, "--names", "Safari", "--domains", "docs.google.com", "--json").status, 0);
  assert.equal(JSON.parse(run("allow", "youtube", "--json").stdout).domain, "youtube.com");
  const shown = JSON.parse(run("show", "--json").stdout);
  assert.deepEqual(shown.overrides, ["youtube.com"]);
  assert.equal(shown.task, "Finish resume");
  const none = JSON.parse(run("tick", "--dry-run", "--json").stdout);
  assert.equal(none.action, "none");
  assert.equal(run("clear", "--json").status, 0);
  assert.equal(JSON.parse(run("show", "--json").stdout).active, false);
});
