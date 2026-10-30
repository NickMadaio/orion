// Read-only access to everything the knowledge graph is built from. Every reader tolerates a missing or broken file
// (the graph gets smaller and `sources` says why); nothing here writes.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const text = (path) => { try { return readFileSync(path, "utf8"); } catch { return null; } };
const json = (path) => { const t = text(path); if (t == null) return null; try { return JSON.parse(t); } catch { return null; } };
const jsonl = (path) => {
  const t = text(path);
  if (t == null) return null;
  return t.split("\n").flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });
};

/** Labels used in citations: relative to ~/.openclaw, so the graph never carries a home-directory path. */
export const LABEL = {
  user: "workspace/USER.md", memory: "workspace/MEMORY.md", daily: (name) => `workspace/memory/${name}`,
  controlled: (name) => `orion-controlled/${name}`, calendarLive: "calendar (orion-reschedule show)",
};

const CONTROLLED_JSON = {
  places: "places.json", knownPlaces: "known-places.json", location: "location.json", routines: "learned-routines.json",
  patterns: "patterns.json", lifeConfig: "life-config.json", projects: "projects.json", glance: "glance-calendar.json",
  focusActivity: "focus-activity.json", sleepActual: "sleep-actual.json", health: "health-log.json",
};

function dailyNotes(workspaceDir) {
  let names = [];
  try { names = readdirSync(join(workspaceDir, "memory")).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)); } catch {}
  // Newest first: the first citation of a repeated pairing is its latest.
  return names.sort().reverse().map((name) => ({ name, date: name.slice(0, 10), lines: text(join(workspaceDir, "memory", name))?.split("\n") ?? [] }));
}

/**
 * The live calendar, through `orion-reschedule show --json`. Without Calendar access (a terminal, CI, a fresh Mac)
 * that refuses, and the graph falls back to glance-calendar.json, the app's own last export.
 */
export function rescheduleProbe(bin, { timeoutMs = 8000 } = {}) {
  return () => {
    const r = spawnSync(process.execPath, [bin, "show", "--json"], { encoding: "utf8", timeout: timeoutMs });
    if (r.status !== 0) return { ok: false, note: (r.stderr || r.stdout || "no calendar").trim().split("\n")[0].slice(0, 120) };
    try {
      const day = JSON.parse(r.stdout);
      return { ok: true, blocks: Array.isArray(day.blocks) ? day.blocks : [] };
    } catch { return { ok: false, note: "unreadable calendar output" }; }
  };
}

export function loadSources({ workspaceDir, controlledDir, calendarProbe }) {
  const controlled = Object.fromEntries(Object.entries(CONTROLLED_JSON).map(([key, name]) => [key, json(join(controlledDir, name))]));
  const live = calendarProbe ? calendarProbe() : { ok: false, note: "calendar not probed" };
  return {
    user: text(join(workspaceDir, "USER.md"))?.split("\n") ?? null,
    memory: text(join(workspaceDir, "MEMORY.md"))?.split("\n") ?? null,
    daily: dailyNotes(workspaceDir),
    focusHistory: jsonl(join(controlledDir, "focus-history.jsonl")),
    calendar: live.ok ? { live: true, blocks: live.blocks, deadlines: [], todos: [] }
      : { live: false, note: live.note, ...(controlled.glance ?? {}) },
    ...controlled,
  };
}

/** What was read, for the graph's `sources` list and the view's footer. */
export function sourceReport(src) {
  const row = (id, file, ok, items, note) => ({ id, file, ok, ...(items != null ? { items } : {}), ...(note ? { note } : {}) });
  const calendarNote = src.calendar.live ? "live" : `${src.calendar.note ?? "no live calendar"}; used ${LABEL.controlled("glance-calendar.json")}`;
  return [
    row("user", LABEL.user, !!src.user, src.user?.length),
    row("memory", LABEL.memory, !!src.memory, src.memory?.length),
    row("daily", "workspace/memory/*.md", src.daily.length > 0, src.daily.length),
    ...Object.entries(CONTROLLED_JSON).map(([key, name]) => row(key, LABEL.controlled(name), src[key] != null)),
    row("focusHistory", LABEL.controlled("focus-history.jsonl"), src.focusHistory != null, src.focusHistory?.length),
    row("calendar", src.calendar.live ? LABEL.calendarLive : LABEL.controlled("glance-calendar.json"),
      src.calendar.live || src.glance != null, (src.calendar.blocks ?? []).length, calendarNote),
  ];
}
