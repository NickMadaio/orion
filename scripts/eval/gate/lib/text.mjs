// Swift String semantics, which differ from JS in two ways that matter here: `count` and `prefix(n)` work
// on grapheme clusters, not UTF-16 units, and `.whitespaces` is horizontal space only (never a newline).
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

export const graphemes = (s) => Array.from(segmenter.segment(s), (x) => x.segment);
export const gcount = (s) => (/^[\x00-\x7f]*$/.test(s) ? s.length : graphemes(s).length);
/** Swift `String.prefix(n)`. */
export const gprefix = (s, n) => (gcount(s) <= n ? s : graphemes(s).slice(0, n).join(""));

const HSPACE = "[ \\t\\u00a0\\u1680\\u2000-\\u200a\\u202f\\u205f\\u3000]";
const HTRIM = new RegExp(`^${HSPACE}+|${HSPACE}+$`, "g");
/** Swift `trimmingCharacters(in: .whitespaces)`. */
export const trimH = (s) => s.replace(HTRIM, "");
/** Swift `trimmingCharacters(in: .whitespacesAndNewlines)`. */
export const trimAll = (s) => s.replace(/^[\s\u0085]+|[\s\u0085]+$/g, "");

/** Swift `ISO8601DateFormatter` (internet date-time, fractional seconds optional) to epoch ms, or null. */
export function parseISO(stamp) {
  if (typeof stamp !== "string") return null;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:?\d\d)$/.test(stamp)) return null;
  const t = Date.parse(stamp.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  return Number.isNaN(t) ? null : t;
}
