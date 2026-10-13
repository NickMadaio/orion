// A to-do's notes (2026-10-06): the spread on the first line, then subtasks
// "- [ ] Title · 40%", then anything else he wrote. The same format as
// native/OrionMobile/Sources/MobileCore/TaskNotes.swift; only the parent to-do
// is scheduled, the subtasks track progress.

const SUB = /^- (?:\[( |x|X)\] )?(.+?)(?:\s*[·\-–]?\s*(\d{1,3})\s*%)?\s*$/;

export function parseTaskNotes(notes) {
  const out = { spread: "", subtasks: [], other: [] };
  for (const raw of String(notes ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.startsWith("- ") ? SUB.exec(line) : null;
    if (m && m[2].trim()) {
      const checked = m[1] === "x" || m[1] === "X";
      const percent = checked ? 100 : Math.min(100, Math.max(0, Number(m[3] ?? 0)));
      out.subtasks.push({ title: m[2].trim(), percent, done: percent >= 100 });
    } else if (/^spread:/i.test(line)) out.spread = line.slice(7).trim();
    // "Tags:"/"Order:" are the apps' lines and "Notes:" marks details written with no spread
    // (2026-10-13), so none of them is ever read as the spread.
    else if (/^(tags|order):/i.test(line)) out.other.push(line);
    else if (/^notes:/i.test(line)) out.other.push(line.slice(6).trim());
    else if (!out.spread && !out.subtasks.length && !out.other.length) out.spread = line;
    else out.other.push(line);
  }
  return out;
}

export function formatTaskNotes({ spread = "", subtasks = [], other = [] }) {
  // With no spread and no subtasks, a free first line would read back as the spread: mark it.
  const bare = !spread.trim() && !subtasks.length;
  const firstFree = bare ? other.findIndex((line) => !/^(tags|order):/i.test(line)) : -1;
  return [
    ...(spread.trim() ? [spread.trim()] : []),
    ...subtasks.map((s) => `- [${s.percent >= 100 ? "x" : " "}] ${s.title} · ${Math.min(100, Math.max(0, s.percent))}%`),
    ...other.map((line, i) => (i === firstFree ? `Notes: ${line}` : line)),
  ].join("\n");
}

export const progressOf = (subtasks) => (subtasks.length ? Math.floor(subtasks.reduce((s, x) => s + x.percent, 0) / subtasks.length) : null);
