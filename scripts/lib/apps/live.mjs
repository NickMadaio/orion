// The real Mac behind orion-apps: lsappinfo (every app, Dock or not), the window list (windows and their stacking), pmset (who is playing audio),
// ps (an app's helper processes), and NSRunningApplication for the normal quit. Needs no Automation or Accessibility permission.
// The same shape as the stub the tests use: snapshot() / alive / tree / quit / hide / signal / windowCount / ownsTree / sleep.
import { execFileSync } from "node:child_process";

const run = (cmd, args, timeout = 8000) => { try { return execFileSync(cmd, args, { encoding: "utf8", timeout, maxBuffer: 8 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };
const jxa = (code) => run("/usr/bin/osascript", ["-l", "JavaScript", "-e", code]);

// Never part of "an app's tree", whatever matches: the OS, and anything of ORION's own.
const SYSTEM_PATH = /^\/(?:System|usr|bin|sbin|Library\/Apple)\//;
const ORION_PATH = /orion|openclaw/i;
// Document-based apps: asked to save, never killed over unsaved work.
const DOC_IDS = /com\.apple\.(?:iwork\.|textedit|preview|dt\.xcode|notes|mail)|com\.microsoft\.(?:word|excel|powerpoint)|com\.adobe\.|com\.microsoft\.vscode|com\.sublimetext|com\.jetbrains|dev\.zed|com\.apple\.finalcutpro|com\.apple\.logic/i;

/** lsappinfo list -> [{ asn, name, bundleId, path, pid, type }] */
export function parseLsappinfo(text) {
  const out = [];
  for (const block of text.split(/\n(?=\s*\d+\) ")/)) {
    const head = /^\s*\d+\) "(.*?)" (ASN:[0-9a-fx-]+):/.exec(block);
    const pid = /\bpid = (\d+)/.exec(block);
    if (!head || !pid) continue;
    out.push({ asn: head[2], name: head[1], bundleId: /bundleID="(.*?)"/.exec(block)?.[1] ?? "", path: /bundle path="(.*?)"/.exec(block)?.[1] ?? "",
      pid: Number(pid[1]), type: /type="(\w+)"/.exec(block)?.[1] ?? "" });
  }
  return out;
}

/** pmset -g assertions -> the pids playing sound (an audio-out assertion, or a "Playing audio" one). */
export function audiblePids(text) {
  const pids = new Set();
  for (const block of text.split(/\n(?=\s*pid \d+)/)) {
    const owner = /^\s*pid (\d+)\(/.exec(block)?.[1];
    const forPid = /Created for PID: (\d+)/.exec(block)?.[1];
    if (/Resources:[^\n]*audio-out/.test(block) && forPid) pids.add(Number(forPid));
    if (/named: "Playing audio"/i.test(block) && owner) pids.add(Number(owner));
  }
  return pids;
}

/** ps -axo pid=,ppid=,comm= -> [{ pid, ppid, comm }] (comm is the full path, spaces and all) */
export function parsePs(text) {
  return text.split("\n").map((l) => /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(l)).filter(Boolean).map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), comm: m[3] }));
}

/** The app's own processes: itself, its descendants, anything running out of its bundle, anything whose bundle id extends its own. */
export function treeOf(app, procs, entries, mine) {
  const inTree = new Set(procs.some((p) => p.pid === app.pid) ? [app.pid] : []);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of procs) if (!inTree.has(p.pid) && inTree.has(p.ppid)) { inTree.add(p.pid); grew = true; }
  }
  const prefix = app.bundleId ? `${app.bundleId}.` : null;
  const byId = new Set(entries.filter((e) => prefix && e.bundleId.startsWith(prefix)).map((e) => e.pid));
  return procs.filter((p) => {
    const inBundle = app.path && p.comm.startsWith(`${app.path}/`);
    if (!(inTree.has(p.pid) || inBundle || byId.has(p.pid))) return false;
    if (p.pid <= 1 || mine.has(p.pid) || ORION_PATH.test(p.comm)) return false;
    return inBundle || p.pid === app.pid || !SYSTEM_PATH.test(p.comm);
  }).map((p) => ({ pid: p.pid, name: p.comm.split("/").pop() }));
}

const WINDOWS_JS = `ObjC.import('CoreGraphics');
const all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(0, 0)));
JSON.stringify(all.filter(w => w.kCGWindowLayer === 0).map(w => [w.kCGWindowOwnerPID, !!w.kCGWindowIsOnscreen]))`;
const signalJs = (pid, method) => `ObjC.import('AppKit'); const a = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}); a ? a.${method}() : false`;

function isDocument(app) {
  if (DOC_IDS.test(app.bundleId)) return true;
  try {
    const plist = JSON.parse(run("/usr/bin/plutil", ["-convert", "json", "-o", "-", `${app.path}/Contents/Info.plist`]) || "{}");
    return (plist.CFBundleDocumentTypes ?? []).some((t) => t.CFBundleTypeRole === "Editor");
  } catch { return false; }
}

function ancestors() {
  const procs = parsePs(run("/bin/ps", ["-axo", "pid=,ppid=,comm="]));
  const parent = new Map(procs.map((p) => [p.pid, p.ppid]));
  const set = new Set([process.pid]);
  for (let p = parent.get(process.pid); p && p > 1 && !set.has(p); p = parent.get(p)) set.add(p);
  return set;
}

export function liveSource() {
  const mine = ancestors();
  const entries = () => parseLsappinfo(run("/usr/bin/lsappinfo", ["list"]));
  const procs = () => parsePs(run("/bin/ps", ["-axo", "pid=,ppid=,comm="]));
  const windows = () => { try { return JSON.parse(jxa(WINDOWS_JS) || "[]"); } catch { return []; } };
  const windowCount = (pid) => windows().filter(([p]) => p === pid).length;
  return {
    snapshot() {
      const all = entries();
      const front = run("/usr/bin/lsappinfo", ["front"]).trim().replace(/:$/, "");
      const stack = windows();
      const sound = audiblePids(run("/usr/bin/pmset", ["-g", "assertions"]));
      const order = [];                                                    // pids by their front-most on-screen window
      for (const [pid, on] of stack) if (on && !order.includes(pid)) order.push(pid);
      const system = /^\/(?:System\/Library|usr|bin|sbin|Library\/Apple)\//;
      return all.filter((e) => (e.type === "Foreground" || (e.type === "UIElement" && !e.bundleId.startsWith("com.apple."))) && e.path && !system.test(e.path) && !/helper|crashpad|agent$/i.test(e.name) && !all.some((o) => o.path && o.pid !== e.pid && o.path !== e.path && e.path.startsWith(`${o.path}/`)))
        .map((e) => {
          const mine_ = stack.filter(([p]) => p === e.pid);
          const rank = order.indexOf(e.pid);
          return { name: e.name, bundleId: e.bundleId, pid: e.pid, path: e.path, kind: e.type === "Foreground" ? "regular" : "accessory", frontmost: e.asn === front,
            windows: mine_.length, onscreen: mine_.filter(([, on]) => on).length, rank: rank < 0 ? null : rank, audible: sound.has(e.pid), document: isDocument(e) };
        });
    },
    alive: (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } },
    tree: (app) => treeOf(app, procs(), entries(), mine),
    quit: (app) => { jxa(signalJs(app.pid, "terminate")); },
    hide: (app) => jxa(signalJs(app.pid, "hide")).trim() === "true",
    signal: (pid, sig) => { if (pid > 1 && !mine.has(pid)) { try { process.kill(pid, sig); } catch { /* already gone */ } } },
    windowCount: (app) => windowCount(app.pid),
    ownsTree: (rest) => rest.some((p) => mine.has(p.pid)),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}
