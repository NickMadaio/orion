import { createHash } from "node:crypto";

/**
 * Parse command-line arguments into a manual attention item.
 *
 * @param {string[]} argv - Array of argument strings.
 * @param {{ now: number }} options - Options object containing `now` (ms timestamp).
 * @returns {object} A valid attention item.
 */
export function parseManualAttention(argv, { now }) {
  const title = findTitle(argv);
  if (!title) throw new TypeError("title is required");

  const flags = parseFlags(argv, title);

  const id = buildId(title, now);
  const dedupKey = buildDedupKey(title);

  return {
    id,
    source: "manual",
    kind: "reminder",
    title,
    detail: "",
    observedAt: now,
    dueAt: flags.due ?? null,
    expiresAt: flags.expires ?? null,
    dedupKey,
    signals: {
      urgency: flags.urgency ?? null,
      actionability: 0.8,
      novelty: null,
      confidence: 1,
      importance: flags.importance ?? null,
      interruptibility: null,
    },
  };
}

/**
 * Find the first non-flag argument as the title.
 */
function findTitle(argv) {
  for (const arg of argv) {
    if (!arg.startsWith("--")) return arg.trim();
  }
  return null;
}

/**
 * Parse known flags from argv. Throws TypeError on bad/unknown flags.
 */
function parseFlags(argv, title) {
  const result = {};
  const knownFlags = new Set(["--due", "--expires", "--urgency", "--importance"]);

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      i++;
      continue;
    }

    if (!knownFlags.has(arg)) {
      throw new TypeError(`unknown flag ${arg}`);
    }

    const nextIdx = i + 1;
    if (nextIdx >= argv.length) {
      throw new TypeError(`${arg} needs a value`);
    }

    const value = argv[nextIdx];

    if (arg === "--due" || arg === "--expires") {
      const ms = Date.parse(value);
      if (Number.isNaN(ms)) {
        throw new TypeError(
          `${arg} must be a date`
        );
      }
      result[arg.slice(2)] = ms;
    } else if (arg === "--urgency" || arg === "--importance") {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        throw new TypeError(`${arg} must be between 0 and 1`);
      }
      result[arg.slice(2)] = n;
    }

    i += 2;
  }

  return result;
}

/**
 * Build the item id: manual:<first 12 hex of sha256(title|now)>
 */
function buildId(title, now) {
  const hash = createHash("sha256")
    .update(`${title}|${now}`)
    .digest("hex");
  return `manual:${hash.slice(0, 12)}`;
}

/**
 * Build the dedup key: manual:<lowercased title with non-alnum runs replaced by ->, truncated to 100 chars.
 */
function buildDedupKey(title) {
  const lower = title.toLowerCase();
  const slug = lower.replace(/[^a-z0-9]+/g, "-");
  return `manual:${slug.slice(0, 100)}`;
}
