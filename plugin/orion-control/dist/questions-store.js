/*
 ORION's questions for Nick, as the plugin reads them (wave 12 L1, 2026-11-02). The file is written only by scripts/orion-questions
 (scripts/lib/brain/questions.mjs owns its shape); this side reads: which question his message may be answering, what is open,
 and what he already answered, for the state card. Every reader is total: a missing or broken file is no questions.
*/
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sandboxNowMs } from "./plugin-clock.js";
/** questions.jsonl, or eval-questions.jsonl while a sandboxed evaluation runs (the scripts' rule, plugin-clock.ts). */
export const questionsFile = (stateDir, realNow) => join(stateDir, sandboxNowMs({ dir: stateDir, ...(realNow ? { realNow } : {}) }) !== null ? "eval-questions.jsonl" : "questions.jsonl");
export function readQuestionRows(path) {
    let text;
    try {
        text = readFileSync(path, "utf8");
    }
    catch {
        return [];
    }
    return text.split("\n").flatMap((line) => {
        if (!line.trim())
            return [];
        try {
            const r = JSON.parse(line);
            return r && typeof r.id === "string" && typeof r.q === "string" && typeof r.status === "string" ? [r] : [];
        }
        catch {
            return [];
        }
    });
}
const RANK = { high: 0, normal: 1, low: 2 };
/** Open questions in the order they would be asked: never-asked first, then priority, then oldest. */
export const openRows = (rows) => rows.filter((r) => r.status === "open" || r.status === "asked")
    .sort((a, b) => (a.askCount ?? 0) - (b.askCount ?? 0) || (RANK[a.priority ?? "normal"] ?? 1) - (RANK[b.priority ?? "normal"] ?? 1) || Date.parse(a.created ?? "") - Date.parse(b.created ?? ""));
export const PUSH_ANSWER_MS = 3 * 3600_000;
export const CHAT_ANSWER_MS = 30 * 60_000;
const norm = (s) => s.toLowerCase().replace(/^question for you:\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
/**
 The question his message may answer: asked and unanswered, newest first. A push binds for 3 h, and only while it is still the last thing
 ORION sent (the app's label names it, or the card's last push is it); a question listed in chat binds for 30 min.
*/
export function awaitingRow(rows, now, seen) {
    const t = now.getTime();
    const asked = rows.filter((r) => r.status === "asked" && r.askedAt && t - Date.parse(r.askedAt) >= 0)
        .sort((a, b) => Date.parse(b.askedAt) - Date.parse(a.askedAt));
    for (const r of asked) {
        const age = t - Date.parse(r.askedAt);
        if (r.askedVia === "chat") {
            if (age <= CHAT_ANSWER_MS)
                return r;
            continue;
        }
        if (age > PUSH_ANSWER_MS)
            continue;
        const sent = norm(r.askedText || r.q);
        if (seen.label !== undefined) {
            if (norm(seen.label) === sent)
                return r;
            continue;
        }
        const push = seen.lastPush;
        if (!push || norm(push.text) === sent)
            return r;
    }
    return undefined;
}
/** "He answered your questions: Who is Sam? → my gym buddy; …" for the state card: the newest three in 30 days. Pure. */
export function answeredLine(rows, now, max = 3) {
    const recent = rows.filter((r) => r.status === "answered" && r.fact && r.answeredAt && now.getTime() - Date.parse(r.answeredAt) <= 30 * 86400_000)
        .sort((a, b) => Date.parse(b.answeredAt) - Date.parse(a.answeredAt)).slice(0, max);
    return recent.length ? `- He answered your questions (his own words; use them): ${recent.map((r) => r.fact.slice(0, 160)).join("; ")}` : "";
}
/** The card line from the state dir, or "" (never throws). */
export function answeredCardLine(stateDir, now) {
    if (!stateDir)
        return "";
    try {
        return answeredLine(readQuestionRows(questionsFile(stateDir)), now);
    }
    catch {
        return "";
    }
}
