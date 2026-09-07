import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_EPISODE = 600;
const DAILY_BEGIN = "<!-- orion-daily:begin";

// The same common credential families refused by orion-remember, plus names
// that indicate somebody pasted a secret even when its provider uses an
// unfamiliar token shape. Automatic capture must err toward forgetting.
const SECRET_SHAPED =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|client[_ -]?secret|api[_ -]?key|password|one[- ]time code|verification code)\b/i;

const DURABLE_SIGNAL = new RegExp(
  [
    "remember",
    "don'?t forget",
    "before i forget",
    "from now on",
    "going forward",
    "keep (?:this|that|it) in mind",
    "always",
    "never",
    "prefer(?:ence|red|s)?",
    "don'?t like",
    "do not like",
    "should",
    "must",
    "we (?:definitely |def |really )?need to",
    "we (?:decided|agreed|chose)",
    "i (?:decided|disagree|have to disagree)",
    "our (?:model|goal|priority|rule)",
    "(?:that|this) is (?:our|the) (?:model|goal|priority|rule)",
    "(?:that'?s|that is) (?:wrong|not right)",
    "actually",
    "instead of",
  ].join("|"),
  "i",
);

const DURABLE_PERSONAL_FACT =
  /\bmy\s+(?:browser|email|phone|number|timezone|location|name|schedule|workflow|editor|computer|mac|preference)\b.{0,120}\b(?:is|are|uses?|means?)\b/i;

function clean(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalized(value: string): string {
  return clean(value).toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Select durable, user-authored facts and decisions without asking a model.
 *
 * This is the fast episodic stream, not semantic memory. It intentionally
 * over-captures a few project decisions into the daily journal; the later
 * consolidation pass decides what deserves long-term promotion. Zero model
 * calls means capture cannot itself become a token leak.
 */
export function episodeFromUserText(input: string): string | undefined {
  const source = clean(input);
  if (!source || SECRET_SHAPED.test(source)) return undefined;

  const candidates = input
    .replace(/\r/g, "\n")
    .split(/\n+|(?<=[.!?])\s+/)
    .map(clean)
    .filter(Boolean);

  const selected: string[] = [];
  for (const candidate of candidates) {
    const explicit =
      /\b(?:remember|don'?t forget|before i forget|from now on|going forward)\b/i.test(candidate);
    if (candidate.endsWith("?") && !explicit) continue;
    if (!DURABLE_SIGNAL.test(candidate) && !DURABLE_PERSONAL_FACT.test(candidate)) continue;
    if (SECRET_SHAPED.test(candidate)) continue;
    if (!selected.some((existing) => normalized(existing) === normalized(candidate))) {
      selected.push(candidate);
    }
    if (selected.join(" ").length >= MAX_EPISODE || selected.length >= 4) break;
  }

  if (selected.length === 0) return undefined;
  return clean(selected.join(" ")).slice(0, MAX_EPISODE);
}

export function defaultEpisodicMemoryPath(configured?: string): string {
  return configured
    ? path.resolve(configured)
    : path.join(os.homedir(), ".openclaw", "workspace", "memory");
}

export async function appendEpisode(
  memoryDirectory: string,
  episode: string,
  now = new Date(),
): Promise<{ written: boolean; path: string }> {
  const day = now.toLocaleDateString("en-CA");
  const clock = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const target = path.join(memoryDirectory, `${day}.md`);
  await mkdir(memoryDirectory, { recursive: true, mode: 0o700 });
  const existing = existsSync(target) ? await readFile(target, "utf8") : `# ${day}\n`;
  const compact = clean(episode).slice(0, MAX_EPISODE);
  if (!compact || normalized(existing).includes(normalized(compact))) {
    return { written: false, path: target };
  }

  const line = `- ${clock} — [auto] ${compact}`;
  const heading = "## Episodes";
  let updated: string;
  const sectionAt = existing.indexOf(heading);
  if (sectionAt !== -1) {
    const afterHeading = sectionAt + heading.length;
    updated = `${existing.slice(0, afterHeading)}\n\n${line}${existing.slice(afterHeading)}`;
  } else {
    const marker = existing.indexOf(DAILY_BEGIN);
    const section = `${heading}\n\n${line}\n`;
    updated =
      marker === -1
        ? `${existing.trimEnd()}\n\n${section}`
        : `${existing.slice(0, marker)}${section}\n${existing.slice(marker)}`;
  }
  await writeFile(target, updated, { mode: 0o600 });
  return { written: true, path: target };
}
