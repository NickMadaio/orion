/*
 The website guard's state and tick (2026-11-04). The pure decisions are in sites.mjs; this holds what is remembered between ticks
 (focus-web.json: the session's task, allowed apps and sites, one-time overrides, phase end; focus-sites-state.json: the guard's own
 memory) and the tick that reads activity.json and acts. Every effect is passed in, so tests never touch a browser.

 focus-web.json carries what the Mac UI, activity.json's `focus` field and the phone link need:
   {version, active, task, allowedApps:[bundle ids], allowedAppNames, allowedDomains, overrides, startedAt, phase, phaseEnd, checkedAtMs}
*/
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BROWSERS, decideDomain, guardStep, initialGuard, normalizeDomain, nudgeLine } from "./sites.mjs";
import { initialPhoneState, planPhoneEvents } from "./phone-events.mjs";

export const STATUS_EVERY_MS = 30_000;
export const webFile = (dir) => join(dir, "focus-web.json");
const stateFile = (dir) => join(dir, "focus-sites-state.json");

const readJson = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };
function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
}
export const readWeb = (file) => { const w = readJson(file); return w && typeof w === "object" ? w : null; };
export const writeWeb = writeJson;

const uniq = (l) => [...new Set(l)];
export const newWeb = ({ task, apps = [], names = [], domains = [], startedAt, checkedAtMs = 0, phase = "focus", phaseEnd = null }) =>
  ({ version: 1, active: true, task, allowedApps: uniq(apps), allowedAppNames: uniq(names), allowedDomains: uniq(domains.map(normalizeDomain).filter(Boolean)), overrides: [], startedAt, phase, phaseEnd, checkedAtMs });
export const withApps = (web, apps) => ({ ...web, allowedApps: uniq([...web.allowedApps, ...apps.map((a) => a.bundleId)]), allowedAppNames: uniq([...web.allowedAppNames, ...apps.map((a) => a.name)]) });
export const withOverride = (web, domain) => { const d = normalizeDomain(domain); return d ? { ...web, overrides: uniq([...(web.overrides ?? []), d]) } : web; };
export const cleared = (web) => ({ ...web, active: false, phase: null, phaseEnd: null });

// -- effects as text -----------------------------------------------------------------------------------------------------------
const SAFE_HOST = /^[a-z0-9.-]+\.[a-z]{2,}$/;
const SAFE_URL = /^file:\/\/[\w%/.~+-]+$/;
const FAMILY = { "com.apple.Safari": ["Safari", "current tab"], "com.google.Chrome": ["Google Chrome", "active tab"], "com.google.Chrome.canary": ["Google Chrome Canary", "active tab"],
  "com.brave.Browser": ["Brave Browser", "active tab"], "com.microsoft.edgemac": ["Microsoft Edge", "active tab"], "company.thebrowser.Browser": ["Arc", "active tab"] };

/** The AppleScript that sends the front tab to the calm page, only if it is still on `domain`. null for an unknown browser or unsafe text. */
export function redirectScript(bundleId, domain, fileUrl) {
  const family = FAMILY[bundleId];
  if (!family || !SAFE_HOST.test(domain ?? "") || !SAFE_URL.test(fileUrl ?? "")) return null;
  const [app, tab] = family;
  return { app, source: `tell application "${app}"\nif (count of windows) is 0 then return "none"\nset u to URL of ${tab} of front window\nif u contains "${domain}" then\nset URL of ${tab} of front window to "${fileUrl}"\nreturn "moved"\nend if\nreturn "gone"\nend tell` };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const backPageHtml = (task) => `<!doctype html><meta charset="utf-8"><title>Back to ${esc(task)}</title><meta name="viewport" content="width=device-width">
<style>html{background:#0b0d10;color:#e8e6e1;font-family:ui-serif,Georgia,serif;display:grid;place-items:center;height:100%}main{text-align:center}small{font:11px ui-monospace,monospace;letter-spacing:.3em;color:#7d8791}h1{font-weight:400;font-size:34px;margin:.4em 0}</style>
<main><small>ORION FOCUS</small><h1>Back to ${esc(task)}</h1><p style="color:#7d8791">That site isn't part of this session. Close this tab and carry on.</p></main>`;

/** The phone's focus reports (phone-events.mjs): run what the planner says. Never throws: a broken log must not stop the guard. */
async function phoneEvents(deps, web) {
  try {
    const { dir, nowMs } = deps;
    const log = readJson(join(dir, "health-log.json"));
    const stored = readJson(join(dir, "focus-phone-events.json"));
    const { state, actions } = planPhoneEvents({ events: log?.phoneFocusEvents, state: stored && "seen" in stored ? stored : initialPhoneState(), web, nowMs });
    writeJson(join(dir, "focus-phone-events.json"), state);
    for (const a of actions) {
      if (a.kind === "notify") await deps.phoneNotify?.({ id: a.id, text: a.text });
      if (a.kind === "pending") writeJson(join(dir, "focus-ready-pending.json"), a.pending);
    }
  } catch { /* the phone log is a bonus signal */ }
}

// -- the tick ------------------------------------------------------------------------------------------------------------------
const RUNNING = new Set(["running"]);

/** One guard tick. deps: {dir, nowMs, status(): session json|null, notify(line), redirect({bundleId,domain,task}): "ok"|"denied"|"gone"|"failed", learn(task,fromMs,toMs)}. */
export async function runTick(deps) {
  const { dir, nowMs } = deps;
  let web = readWeb(webFile(dir));
  const none = (reason) => ({ action: "none", reason });
  await phoneEvents(deps, web);
  if (!web?.active) return none("no focus session");
  if (nowMs - (web.checkedAtMs ?? 0) >= STATUS_EVERY_MS) {
    const st = await deps.status().catch(() => null);
    if (!st) return none("the session could not be read");
    const live = ["running", "paused", "waiting-for-return"].includes(String(st.status ?? ""));
    if (!live) {
      await deps.learn(web.task, Date.parse(web.startedAt), nowMs).catch(() => {});
      writeWeb(webFile(dir), cleared(web));
      writeJson(stateFile(dir), initialGuard());
      return { action: "finalized", task: web.task };
    }
    web = { ...web, phase: RUNNING.has(String(st.status)) ? (st.phase === "focus" || st.phase === undefined ? "focus" : "rest") : "paused", phaseEnd: new Date(nowMs + Number(st.remainingSeconds ?? 0) * 1000).toISOString(), checkedAtMs: nowMs };
    writeWeb(webFile(dir), web);
  }
  const activity = readJson(join(dir, "activity.json"));
  if (!activity) return none("no activity.json");
  const stored = readJson(stateFile(dir));
  const prev = stored && "domain" in stored ? stored : initialGuard();
  const { state, action, domain } = guardStep(prev, {
    nowMs, active: web.phase === "focus" && activity.focus?.active !== false, activityAtMs: Date.parse(activity.at), bundleId: activity.app?.bundleId,
    domain: activity.domain, allowed: web.allowedDomains, overrides: web.overrides,
  });
  let next = state, result;
  if (action === "nudge") await deps.notify(nudgeLine(domain)).catch(() => {});
  if (action === "redirect") {
    result = await deps.redirect({ bundleId: activity.app.bundleId, domain, task: web.task }).catch(() => "failed");
    if (result === "denied") next = { ...state, deniedAt: nowMs };
  }
  writeJson(stateFile(dir), next);
  return { action, ...(domain ? { domain } : {}), ...(result ? { result } : {}) };
}

export { decideDomain, BROWSERS };
