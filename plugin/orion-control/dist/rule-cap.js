/*
 The cap on learned rules in USER.md (wave 12 fixer, 2026-11-02). Every lasting correction appends "- <date> — Rule: …" through
 orion-remember --user, and nothing ever took one away, so USER.md (loaded whole by cloud sessions) grew without limit. Now:
   - a rule with the same words as one already saved is not saved again (learnCorrection asks hasRule first);
   - near-identical rules (the same set of words) are merged, the newer kept;
   - above MAX_RULES, the oldest auto-captured rules go first.
 Only "Rule:" one-liners are touched: preferences, the template and multi-line entries never are. Every removal is logged by the
 caller with its full text, and the file is written by tmp + rename only if it has not changed since it was read.
*/
import { appendFileSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export const MAX_RULES = 30;
const RULE = /^- (\d{4}-\d{2}-\d{2}) [—–-] Rule: (.+?)\.?\s*$/;
const LABEL = /^(?:Rule|Preference):\s*/i;
const words = (s) => [...new Set(s.replace(LABEL, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean))].sort().join(" ");
/** Rules merged and capped, with what went and why. Pure. */
export function capRulesDetailed(text, max = MAX_RULES) {
    const lines = text.split("\n");
    const rules = lines.flatMap((line, at) => {
        const m = line.match(RULE);
        return m && !/^\s+\S/.test(lines[at + 1] ?? "") ? [{ at, line, date: m[1], key: words(m[2]) }] : [];
    });
    const newest = new Map();
    for (const r of rules) {
        const seen = newest.get(r.key);
        if (!seen || r.date >= seen.date)
            newest.set(r.key, r);
    }
    const dupes = rules.filter((r) => newest.get(r.key) !== r).map((r) => ({ ...r, action: "drop-duplicate" }));
    const left = rules.filter((r) => newest.get(r.key) === r);
    const over = [...left].sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at).slice(0, Math.max(0, left.length - max))
        .map((r) => ({ ...r, action: "drop-over-cap" }));
    const removed = [...dupes, ...over];
    if (!removed.length)
        return { text, removed: [] };
    const gone = new Set(removed.map((r) => r.at));
    return { text: lines.filter((_, i) => !gone.has(i)).join("\n"), removed: removed.map((r) => ({ line: r.line, action: r.action })) };
}
/** Rules merged and capped; `dropped` lists the removed lines. Pure. */
export function capRules(text, max = MAX_RULES) {
    const out = capRulesDetailed(text, max);
    return { text: out.text, dropped: out.removed.map((r) => r.line) };
}
/** True when USER.md already holds a rule or preference with the same words as `fact` ("Rule: …" / "Preference: …"). */
export function hasRule(userMd, fact) {
    if (!userMd)
        return false;
    const want = words(fact);
    return userMd.split("\n").some((l) => { const m = l.match(/^- \d{4}-\d{2}-\d{2} [—–-] ((?:Rule|Preference): .+?)\.?\s*$/); return !!m && words(m[1]) === want; });
}
/** Applies the cap to the file on disk and logs each removal (full text) to `<stateDir>/learned-rules.jsonl`. Never throws. */
export function enforceRuleCap(userMdPath, stateDir, now = new Date()) {
    try {
        const before = readFileSync(userMdPath, "utf8");
        const out = capRulesDetailed(before);
        if (!out.removed.length)
            return 0;
        const tmp = `${userMdPath}.${process.pid}.rules.tmp`;
        writeFileSync(tmp, out.text);
        if (readFileSync(userMdPath, "utf8") !== before) {
            unlinkSync(tmp);
            return 0;
        } // changed meanwhile: next save retries
        renameSync(tmp, userMdPath);
        if (stateDir) {
            const at = now.toISOString();
            appendFileSync(join(stateDir, "learned-rules.jsonl"), out.removed.map((r) => `${JSON.stringify({ at, action: r.action, text: r.line, max: MAX_RULES })}\n`).join(""));
        }
        return out.removed.length;
    }
    catch {
        return 0;
    }
}
