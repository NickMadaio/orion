// The four commands of orion-apps over any source (the live Mac, or a stub in tests). Each returns { ok, ..., say }: say is the reply, ready to read out.
import { closeApp } from "./escalate.mjs";
import { RECENT_RANKS, keptReason, matchApps, refusedReason, unusedWhy } from "./policy.mjs";

const list = (xs) => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

const view = (a) => ({ name: a.name, bundleId: a.bundleId, kind: a.kind, frontmost: !!a.frontmost, windows: a.windows, onscreen: a.onscreen, rank: a.rank,
  audible: !!a.audible, lastActive: a.rank === null || a.rank === undefined ? null : a.rank === 0 ? "now" : `window ${a.rank + 1} from the front` });

/** What a closed app becomes in the reply: "Epic Games Launcher (it ignored a normal quit, so I ended it, helpers EpicWebHelper included)". */
function closedLine(r) {
  const helpers = r.helpers.length ? `, ${r.helpers.length > 1 ? "helpers" : "helper"} ${list(r.helpers)} included` : "";
  if (r.how === "quit") return r.name;
  return `${r.name} (it ignored a normal quit, so I ${r.how === "term" ? "ended" : "force-stopped"} it${helpers})`;
}

/** The sentence about a set of close results. */
export function sayResults(results) {
  const by = (s) => results.filter((r) => r.state === s);
  const parts = [];
  if (by("closed").length) parts.push(`Closed ${list(by("closed").map(closedLine))}.`);
  for (const r of by("asking_to_save")) parts.push(`${r.name} is asking to save, so I left it open for you.`);
  if (by("still_open").length) parts.push(`${list(by("still_open").map((r) => r.name))} wouldn't go away even after a force-stop, so ${by("still_open").length > 1 ? "they are" : "it is"} still running.`);
  if (by("left_alone").length) parts.push(`${list(by("left_alone").map((r) => r.name))} is what this chat itself runs from, so I didn't touch it.`);
  if (by("not_running").length) parts.push(`${list(by("not_running").map((r) => r.name))} ${by("not_running").length > 1 ? "were" : "was"} already closed.`);
  return parts.join(" ");
}

export function listApps(src) {
  const apps = src.snapshot();
  const rows = apps.map(view);
  const dock = apps.filter((a) => a.kind === "regular"), bg = apps.filter((a) => a.kind === "accessory");
  const front = apps.find((a) => a.frontmost);
  const say = apps.length
    ? `${plural(dock.length, "app")} open${front ? `, you're in ${front.name}` : ""}: ${list(dock.map((a) => `${a.name}${a.audible ? " (playing audio)" : ""}`))}.${bg.length ? ` Running in the background or menu bar: ${list(bg.map((a) => a.name))}.` : ""}`
    : "I can't see any apps running.";
  return { ok: true, count: apps.length, apps: rows, say };
}

/** quit <name...>: every app a name could mean, closed until gone. Named apps close even if "unused" would have kept them; Finder and ORION never. */
export async function quitNamed(src, names, opts = {}) {
  const apps = src.snapshot();
  const results = [], unknown = [];
  const seen = new Set();
  for (const n of names) {
    const found = matchApps(n, apps).filter((a) => !seen.has(a.pid));
    if (!found.length) { unknown.push(n); continue; }
    for (const a of found) {
      seen.add(a.pid);
      const refused = refusedReason(a);
      results.push(refused ? { name: a.name, state: "refused", how: null, helpers: [], why: refused } : await closeApp(a, src, opts));
    }
  }
  const say = [sayResults(results.filter((r) => r.state !== "refused")), ...results.filter((r) => r.state === "refused").map((r) => `${r.why}.`),
    unknown.length ? `${list(unknown)} ${unknown.length > 1 ? "aren't" : "isn't"} open.` : ""].filter(Boolean).join(" ") || "Nothing to close.";
  return { ok: true, closed: results.filter((r) => r.state === "closed").map((r) => r.name), results, unknown, say };
}

/** quit-unused: every app that is not protected and not in recent use. See policy.mjs for the definition. */
export async function quitUnused(src, { keep = [], dryRun = false, all = false, ...opts } = {}) {
  const apps = src.snapshot();
  const plan = apps.map((a) => ({ app: a, kept: keptReason(a, { keep, all }) }));
  const targets = plan.filter((p) => !p.kept).map((p) => p.app);
  const kept = plan.filter((p) => p.kept && p.app.kind === "regular").map((p) => ({ name: p.app.name, why: p.kept }));
  const keptBg = plan.filter((p) => p.kept && p.app.kind === "accessory" && !/never closed/.test(p.kept)).map((p) => p.app.name);
  const would = targets.map((a) => ({ name: a.name, why: unusedWhy(a) }));
  const groups = [...new Set(kept.map((k) => k.why))].map((why) => `${list(kept.filter((k) => k.why === why).map((k) => k.name))} (${why})`);
  const keptSay = kept.length ? ` Kept ${groups.join("; ")}.` : "";
  const basis = all ? "Everything not on your keep list and not protected (Finder, ORION, terminals, editors, calls) was closed." : `"Unused" here means not in front, not among your ${RECENT_RANKS} most recent windows, not playing audio, and not a terminal, editor, call or recording app. macOS doesn't record when an app was last used, so I go by the window stack.`;
  if (!targets.length) return { ok: true, dryRun, closed: [], kept, results: [], would, say: `Nothing looked unused, so I closed nothing.${keptSay}` };
  if (dryRun) return { ok: true, dryRun: true, closed: [], kept, results: [], would, say: `I would close ${list(would.map((w) => `${w.name} (${w.why})`))}.${keptSay}` };
  const results = await Promise.all(targets.map((a) => closeApp(a, src, opts)));   // each waits its own 5 s + 3 s; in turn would be minutes
  const closed = results.filter((r) => r.state === "closed").map((r) => r.name);
  return { ok: true, dryRun: false, closed, kept, keptBackground: keptBg, results, say: `${sayResults(results)}${keptSay} ${basis}`.trim() };
}

export function hideApp(src, name) {
  const [app] = matchApps(name, src.snapshot());
  if (!app) return { ok: false, error: `${name} isn't open`, say: `${name} isn't open.` };
  const refused = refusedReason(app);
  if (refused) return { ok: false, error: refused, say: `${refused}.` };
  const hidden = src.hide(app);
  return hidden ? { ok: true, hidden: app.name, say: `Hid ${app.name}.` } : { ok: false, error: `${app.name} wouldn't hide`, say: `${app.name} wouldn't hide.` };
}
