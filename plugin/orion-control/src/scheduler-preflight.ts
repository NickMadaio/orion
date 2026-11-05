/*
 A worker's scheduler write that the scheduler would refuse never runs (live gate run 3, #36 #37).
 The 9B ran `orion-reschedule add "Catch up call with dad" 40 --after "Lunch"` with no lunch on the day; the scheduler refused with a
 non-zero exit, and the host appended "⚠️ 🛠️ Exec failed: `…`" to the reply AFTER the plugin's last hook, where no sanitizer reaches.
 The only way such a line never reaches him is for the failing exec never to happen: the same command is first run with --dry-run
 (which writes nothing), and a refusal is returned to the worker as the tool's answer, so it says it plainly in its own words.
 Pure parsing here; local-routing.ts runs it.
*/
const WRITE_VERBS = new Set(["add", "move", "drop", "resize", "extend", "swap", "rename", "skip", "displace", "log", "late", "busy", "overrun", "now"]);

/** The scheduler's argv in a plain `orion-reschedule <verb> …` command (quotes only, no shell), or undefined for anything else. */
export function schedulerArgs(command: string): string[] | undefined {
  const text = command.trim();
  if (/[;&|<>`$(){}\n]/.test(text.replace(/"[^"]*"|'[^']*'/g, ""))) return undefined;
  const words = [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
  const at = words.findIndex((w) => /(?:^|\/)orion-reschedule$/.test(w));
  if (at < 0 || at > 1 || (at === 1 && !/^(?:node|bash|sh)$/.test(words[0]!))) return undefined;
  const args = words.slice(at + 1);
  return WRITE_VERBS.has(args[0] ?? "") && !args.includes("--dry-run") ? args : undefined;
}

/** The refusal in a dry run's output, as one plain sentence; undefined when it did not refuse (so the real command runs). */
export function refusalOf(stdout: string, code: number): string | undefined {
  if (code === 0) return undefined;
  const line = stdout.split("\n").map((l) => l.trim()).find((l) => /^(?:MUST-HAVE )?(?:NOTHING WAS|NOT BOOKED|NOT DONE)/.test(l) || /\bNOT BOOKED\b/.test(l));
  if (!line) return undefined;
  return line.replace(/^(?:MUST-HAVE )?NOTHING WAS \w+(?: on [^:]+)?:\s*/i, "").replace(/\s*[—–-]\s*ask .*$/i, "").replace(/\s*\(--[^)]*\)/g, "").trim().slice(0, 200);
}
