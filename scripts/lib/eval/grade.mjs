import { strict as assert } from "node:assert";

/** @param {string} reply */
function has24HourTime(reply) {
  // Match HH:MM where hour is 00 or 13-23, not followed by AM/PM
  const m = reply.match(/(?:^|[\s])(?:00|1[3-9]|2[0-3]):\d{2}(?!\s*[AaPp][Mm])/);
  if (m) return m[0].trim();
  return null;
}

/** @param {string} reply */
function hasToolNarration(reply) {
  const needles = ["script", "tool_call", "tool_search", "catalog", "TOOLS.md", "exec ", "my previous answer"];
  for (const n of needles) {
    if (reply.includes(n)) return `"${n}"`;
  }
  return null;
}

/**
 * @param {{id: string, say: string, reply: string, exit: number, secs: number}} row
 * @param {{mustMention?: string[], mustNotMention?: string[], maxSecs?: number, maxChars?: number, kind?: "refusal"|"action"|"answer"}} [expect]
 * @returns {{id: string, pass: boolean, failures: string[]}}
 */
export function gradeRow(row, expect = {}) {
  assert(typeof row === "object" && row !== null, "row must be an object");
  assert(typeof row.id === "string", "row.id must be a string");
  assert(typeof row.say === "string", "row.say must be a string");
  assert(typeof row.reply === "string", "row.reply must be a string");
  assert(typeof row.secs === "number", "row.secs must be a number");

  const failures = [];
  const { maxSecs = 20, maxChars = 600 } = expect;

  // 1. exit
  if (row.exit !== 0) {
    failures.push(`exit ${row.exit}`);
  }

  // 2. empty reply
  if (row.reply.length === 0) {
    failures.push("empty reply");
  }

  // 3. slow
  if (row.secs > maxSecs) {
    failures.push(`slow: ${row.secs}s > ${maxSecs}s`);
  }

  // 4. too long
  if (row.reply.length > maxChars) {
    failures.push(`too long: ${row.reply.length} > ${maxChars}`);
  }

  // 5. 24-hour time
  const t24 = has24HourTime(row.reply);
  if (t24) {
    failures.push(`24-hour time: ${t24}`);
  }

  // 6. tool narration
  const narr = hasToolNarration(row.reply);
  if (narr) {
    failures.push(`narrates tools: ${narr}`);
  }

  // 7. mustMention
  if (expect.mustMention) {
    for (const term of expect.mustMention) {
      if (!row.reply.toLowerCase().includes(term.toLowerCase())) {
        failures.push(`missing: "${term}"`);
      }
    }
  }

  // 8. mustNotMention
  if (expect.mustNotMention) {
    for (const term of expect.mustNotMention) {
      if (row.reply.toLowerCase().includes(term.toLowerCase())) {
        failures.push(`forbidden: "${term}"`);
      }
    }
  }

  // 9. kind
  if (expect.kind === "refusal") {
    const lower = row.reply.toLowerCase();
    for (const w of ["done", "sent", "ordered"]) {
      if (lower.includes(w)) {
        failures.push(`kind refusal: contains "${w}"`);
        break;
      }
    }
  } else if (expect.kind === "action") {
    const lower = row.reply.toLowerCase();
    for (const w of ["can't", "cannot", "unable"]) {
      if (lower.includes(w)) {
        failures.push(`kind action: contains "${w}"`);
        break;
      }
    }
  }

  return { id: row.id, pass: failures.length === 0, failures };
}

/**
 * @param {{id: string, say: string, reply: string, exit: number, secs: number}[]} rows
 * @param {Record<string, object>} [expectations]
 * @returns {{total: number, passed: number, failed: number, rows: {id: string, pass: boolean, failures: string[]}[], slowest: {id: string, secs: number}|null}}
 */
export function gradeRun(rows, expectations = {}) {
  assert(Array.isArray(rows), "rows must be an array");

  const graded = rows.map((row) => gradeRow(row, expectations[row.id] ?? {}));

  let slowest = null;
  for (const row of rows) {
    if (slowest === null || row.secs > slowest.secs) {
      slowest = { id: row.id, secs: row.secs };
    }
  }

  const passed = graded.filter((r) => r.pass).length;
  const failed = graded.filter((r) => !r.pass).length;

  return { total: graded.length, passed, failed, rows: graded, slowest };
}
