export const KINDS = Object.freeze([
  "class",
  "sleep",
  "gym",
  "deadline",
  "study",
  "side_project",
  "meal",
  "other",
  "rest",
]);

export const SOURCES = Object.freeze([
  "calendar",
  "template",
  "orion",
  "nick",
]);

const ID_RE = /^[a-z0-9][a-z0-9:._-]{0,79}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d);
  if (Number.isNaN(utc)) return false;
  const check = new Date(utc);
  return (
    check.getUTCFullYear() === y &&
    check.getUTCMonth() === m - 1 &&
    check.getUTCDate() === d
  );
}

export function validateBlock(value) {
  const errors = [];

  if (typeof value !== "object" || value === null) {
    return { ok: false, errors: ["invalid block"] };
  }

  // id
  if (
    typeof value.id !== "string" ||
    !ID_RE.test(value.id)
  ) {
    errors.push("id");
  }

  // title
  if (typeof value.title !== "string") {
    errors.push("title");
  } else {
    const trimmed = value.title.trim();
    if (trimmed.length < 1 || trimmed.length > 120) {
      errors.push("title");
    }
  }

  // kind
  if (!KINDS.includes(value.kind)) {
    errors.push("kind");
  }

  // date
  if (typeof value.date !== "string" || !DATE_RE.test(value.date)) {
    errors.push("date");
  } else if (!isRealDate(value.date)) {
    errors.push("date");
  }

  // start
  if (
    typeof value.start !== "number" ||
    !Number.isInteger(value.start) ||
    value.start < 0 ||
    value.start > 1439
  ) {
    errors.push("start");
  }

  // end
  if (
    typeof value.end !== "number" ||
    !Number.isInteger(value.end) ||
    value.end <= 0 ||
    value.end > 1440
  ) {
    errors.push("end");
  }

  // start < end check (only if both are valid integers in range)
  if (
    typeof value.start === "number" &&
    Number.isInteger(value.start) &&
    value.start >= 0 &&
    value.start <= 1439 &&
    typeof value.end === "number" &&
    Number.isInteger(value.end) &&
    value.end > 0 &&
    value.end <= 1440 &&
    value.start >= value.end
  ) {
    errors.push("end");
  }

  // fixed
  if (typeof value.fixed !== "boolean") {
    errors.push("fixed");
  }

  // source
  if (!SOURCES.includes(value.source)) {
    errors.push("source");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true };
}

export function normalizeBlock(value) {
  const result = validateBlock(value);
  if (!result.ok) {
    throw new TypeError("invalid block");
  }

  // Return a NEW object with only the eight known fields.
  // Trim title.
  return Object.freeze({
    id: value.id,
    title: value.title.trim(),
    kind: value.kind,
    date: value.date,
    start: value.start,
    end: value.end,
    fixed: value.fixed,
    source: value.source,
  });
}

export function blockMinutes(block) {
  return block.end - block.start;
}
