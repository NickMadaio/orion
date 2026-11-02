/*
 The mail alerts ORION sent, as the plugin reads them (wave 14, 2026-11-02). Written only by scripts/orion-mail-watch
 (scripts/lib/mail/alert.mjs owns the row shape): mail-alerts.jsonl, or eval-mail-alerts.jsonl while a sandboxed evaluation runs.
 Which alert a short reply ("not important", "this matters") is about: the newest one, while it is still the last thing ORION sent
 (the app's label names it, or the card's last push is it) and under 3 hours old. Every reader is total: a missing file is no alert.
*/
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sandboxNowMs } from "./plugin-clock.js";
export const MAIL_ALERT_BIND_MS = 3 * 3600_000;
export const mailAlertsFile = (stateDir, realNow) => join(stateDir, sandboxNowMs({ dir: stateDir, ...(realNow ? { realNow } : {}) }) !== null ? "eval-mail-alerts.jsonl" : "mail-alerts.jsonl");
export function readMailAlerts(path, max = 10) {
    let text;
    try {
        text = readFileSync(path, "utf8");
    }
    catch {
        return [];
    }
    return text.split("\n").slice(-(max + 1)).flatMap((line) => {
        if (!line.trim())
            return [];
        try {
            const r = JSON.parse(line);
            return r && typeof r.text === "string" && typeof r.at === "string" && Array.isArray(r.items) ? [r] : [];
        }
        catch {
            return [];
        }
    });
}
const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** The alert his reply may be about, or undefined. */
export function currentMailAlert(alerts, now, seen) {
    const newest = alerts.at(-1);
    if (!newest)
        return undefined;
    const age = now.getTime() - Date.parse(newest.at);
    if (!(age >= 0 && age <= MAIL_ALERT_BIND_MS))
        return undefined;
    if (seen.label !== undefined)
        return norm(seen.label) === norm(newest.text) ? newest : undefined;
    return seen.lastPush && norm(seen.lastPush.text) === norm(newest.text) ? newest : undefined;
}
