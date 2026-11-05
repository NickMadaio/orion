/*
 Food turns carried out (w14 g-food, 2026-11-02): food-read.ts says what he meant, scripts/orion-food-estimate does the work and the
 writing, and every reply is built from what that script returned. The offer waiting on a yes is the script's food-pending.json
 (scripts/lib/food/pending.mjs has the contract); a photo from the phone arrives through the food inbox (scripts/lib/food/inbox.mjs),
 because the plugin hook is given only that an image is attached, never the image.

 Binding: a short reply ("yes", "it was a small one") is the offer's only while the offer is still the last thing in this chat.
 FoodMemory records every other turn; a turn about anything else after the offer unbinds it, and a label naming a different
 message unbinds it too. So an inbox offer from three hours ago never swallows a "yes" meant for a gym nudge.
*/
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runMeal } from "./health-log.js";
import { scriptPath } from "./tool-guards.js";
export const PHOTO_LINE = "I can't see photos sent in this chat yet. Send it with the food button on the phone and I'll estimate it, or tell me what it was.";
/** A photo turn reuses an inbox estimate made this recently (the photo he just sent from the phone). */
const PHOTO_REUSE_MS = 30 * 60_000;
/** A text estimate is a few seconds on the resident 9b; the script's own limit is 45 s, this is the hard stop behind it. */
const RUN_TIMEOUT_MS = 50_000;
/** The real script with the plugin's state dir. Wired in by index.ts only. */
export const liveFoodRun = (stateDir) => (args) => new Promise((resolve) => execFile(scriptPath("orion-food-estimate"), args, { timeout: RUN_TIMEOUT_MS, maxBuffer: 1 << 20, env: { ...process.env, ...(stateDir ? { ORION_CONTROLLED_DIR: stateDir } : {}) } }, (e, stdout) => resolve({ stdout: String(stdout ?? ""), code: e ? (typeof e.code === "number" ? e.code : 1) : 0 })));
/** The newest live offer in food-pending.json ({ offers: [...] }, or the older single object), with how many wait and their names. */
export function readFoodPending(stateDir, now) {
    try {
        const raw = JSON.parse(readFileSync(join(stateDir, "food-pending.json"), "utf8"));
        const rows = Array.isArray(raw.offers) ? raw.offers : [raw];
        const live = rows.filter((row) => Number.isFinite(Date.parse(String(row?.at))) && Date.parse(String(row?.expiresAt)) > now.getTime() && typeof row?.offerText === "string");
        const newest = live.at(-1);
        if (!newest)
            return undefined;
        const view = { at: Date.parse(String(newest.at)), via: newest.via === "inbox" ? "inbox" : "chat", offerText: String(newest.offerText) };
        // A photo already logged ("Fix anything?") is not an open question: count and names are the offers still waiting on a yes,
        // and the logged entry rides apart, so a correction goes to it while yes / no / the picks go to the open question.
        const loggedId = [...live].reverse().map((row) => row.logged?.id).find((id) => typeof id === "string");
        if (loggedId)
            view.loggedId = loggedId;
        if (!Array.isArray(raw.offers))
            return view;
        const open = live.filter((row) => !row.logged);
        return { ...view, count: open.length, names: open.map((row) => String(row.name ?? "")) };
    }
    catch {
        return undefined;
    }
}
/** Per chat: when a non-food turn last happened, and the last food entry logged here (for "undo"). */
export class FoodMemory {
    others = new Map();
    logs = new Map();
    otherTurn(key, nowMs) { this.others.set(key, nowMs); }
    /** `ids`: every entry one turn logged ("both"), so "undo" takes them all off; `id` is the last. */
    logged(key, id, nowMs, ids = [id]) { this.logs.set(key, { id, ids: [...ids], at: nowMs }); }
    lastLogged(key) { return this.logs.get(key); }
    forgetLog(key) { this.logs.delete(key); }
    /** The offer is still what this chat is answering: nothing else was said since, and any label is the offer's own line. */
    bound(key, pending, label) {
        if (label && !/Log it\?|Add those numbers|Fix anything\?/.test(label))
            return false;
        return (this.others.get(key) ?? 0) <= pending.at;
    }
}
const parse = (stdout) => { try {
    return JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
}
catch {
    return { ok: false, error: "orion-food-estimate gave no answer" };
} };
const failed = (error) => `I couldn't estimate that just now${error ? ` (${error})` : ""}, so nothing was logged. Say go and I'll retry it.`;
const offerOf = (j) => String(j.offer?.text ?? (j.summary ? `${String(j.summary)}. Log it?` : ""));
const lower = (s) => String(s ?? "").toLowerCase();
async function call(run, args) {
    const r = await run(args).catch((e) => ({ stdout: JSON.stringify({ ok: false, error: String(e) }), code: 1 }));
    return { j: parse(r.stdout), call: `orion-food-estimate ${args.join(" ")}`, out: r.stdout.trim().slice(0, 2000) };
}
function loggedLine(j) {
    if (typeof j.say === "string")
        return `${j.say} Say "undo" to take it off.`; // the script names what it logged
    const e = (j.entry ?? {});
    const l = (j.logged ?? {});
    return `${l.filled ? "Updated" : "Logged"} ${lower(e.title)} as ${lower(e.meal)}: ${e.calories} kcal, ${e.protein} g protein, ${e.carbohydrates} g carbs, ${e.fat} g fat. ${l.dayCalories} kcal today. Say "undo" to take it off.`;
}
/** Carries out one food turn. Never throws; a failure is one honest sentence. */
export async function runFoodTurn(turn, deps) {
    const one = async (args, reply, failure = failed) => {
        const r = await call(deps.run, args);
        if (!r.j.ok)
            return { text: failure(r.j.error), calls: [r.call], outputs: [r.out] };
        const row = r.j.logged;
        const ids = Array.isArray(row?.ids) ? row.ids.map(String).filter(Boolean) : [];
        return { text: reply(r.j), calls: [r.call], outputs: [r.out], ...(row?.id ? { logged: { id: row.id, ...(ids.length > 1 ? { ids } : {}) } } : {}) };
    };
    switch (turn.kind) {
        // A question is answered first ("About 42 g of protein (and ~650 kcal). Want me to log it?"); nothing is logged until a yes.
        case "ask": return one(["--text", turn.text, ...(turn.question ? ["--ask", turn.question] : []), "--offer", "--json"], offerOf);
        case "log": return one(["--text", turn.text, "--log", "--json"], (j) => {
            const l = (j.logged ?? {});
            return l.error ? `${String(j.summary)}. ${l.error}` : `${String(j.summary)}. Logged (${l.dayCalories} kcal today). Say "undo" to take it off.`;
        });
        case "yes": return one(["log-pending", "--json"], (j) => (j.choose ? String(j.say) : loggedLine(j)), (e) => (e ? `I couldn't log it: ${e}.` : "I couldn't log it just now."));
        case "pick": return one(["log-pending", "--pick", turn.which, "--json"], (j) => (j.choose ? String(j.say) : loggedLine(j)), (e) => (e ? `I couldn't log it: ${e}.` : "I couldn't log it just now."));
        case "no": return one(["discard", ...(turn.which ? ["--pick", turn.which] : []), "--json"], (j) => (j.choose || j.kept ? String(j.say) : "Okay, not logged."), () => "Okay, not logged.");
        case "revise": return one(["--revise", turn.correction, ...(turn.which ? ["--pick", turn.which] : []), "--json"], (j) => (j.choose ? String(j.say) : offerOf(j)));
        case "undo": return undoAll(turn.ids?.length ? turn.ids : [turn.id], deps);
        case "that": {
            const pending = readFoodPending(deps.stateDir, deps.now);
            if (pending)
                return { text: pending.offerText, calls: ["read food-pending.json"], outputs: [pending.offerText] };
            return one(["--entry", "latest", "--offer", "--json"], offerOf, (e) => (/no meal|no description/.test(String(e)) ? "I don't have a recent meal to size. Tell me what you had and I'll estimate it." : failed(e)));
        }
        case "photo": {
            const pending = readFoodPending(deps.stateDir, deps.now);
            if (pending?.via === "inbox" && deps.now.getTime() - pending.at <= PHOTO_REUSE_MS)
                return { text: turn.question && pending.loggedId ? `That photo is already in your log. ${pending.offerText}` : pending.offerText, calls: ["read food-pending.json"], outputs: [pending.offerText] };
            return { text: PHOTO_LINE, calls: [], outputs: [] };
        }
        case "meal": return mealThenEstimate(turn.read, deps);
    }
}
/** "had a chicken burrito and a coke for lunch": logged at once (health-log.ts, 0 kcal), then sized; a yes fills that entry. */
async function mealThenEstimate(read, deps) {
    const flow = await runMeal(read, { stateDir: deps.stateDir, now: deps.now });
    if (flow.outcome !== "done")
        return { text: flow.outcome === "say" ? flow.text : "I couldn't log that meal just now.", calls: [], outputs: [] };
    const id = (() => { try {
        return String(JSON.parse(flow.outputs[0] ?? "{}").id ?? "");
    }
    catch {
        return "";
    } })();
    const base = (flow.reply ?? "").replace(/; I didn't guess calories\.$/, "");
    const r = id ? await call(deps.run, ["--entry", id, "--offer", "--json"]) : undefined;
    const calls = [...flow.calls, ...(r ? [r.call] : [])], outputs = [...flow.outputs, ...(r ? [r.out] : [])];
    if (!r?.j.ok)
        return { text: `${base}; I couldn't estimate the calories just now.`, calls, outputs };
    return { text: `${base}. My estimate: ${offerOf(r.j)}`, calls, outputs };
}
const undoFailure = (e) => `I couldn't take it off: ${e ?? "the health log didn't answer"}.`;
/** Takes off every entry one turn logged: one reply naming what came off (or what was put back), the day's total from the last undo. */
async function undoAll(ids, deps) {
    const calls = [], outputs = [], removed = [], restored = [];
    let kcal = 0, restoredKcal = 0, dayCalories, failure;
    for (const id of ids) {
        const r = await call(deps.run, ["undo", id, "--json"]);
        calls.push(r.call);
        outputs.push(r.out);
        if (!r.j.ok) {
            failure = String(r.j.error ?? "");
            continue;
        }
        const e = (r.j.restored ? r.j.entry : r.j.removed ?? {});
        (r.j.restored ? restored : removed).push(lower(e.title));
        if (r.j.restored)
            restoredKcal += Number(e.calories ?? 0);
        else
            kcal += Number(e.calories ?? 0);
        dayCalories = r.j.dayCalories;
    }
    if (!removed.length && !restored.length)
        return { text: undoFailure(failure), calls, outputs };
    const parts = [
        ...(removed.length ? [`Took ${listOfNames(removed)} off (${kcal} kcal).`] : []),
        ...(restored.length ? [`Put ${listOfNames(restored)} back as it was (${restoredKcal} kcal).`] : []),
        `${dayCalories} kcal today.`,
        ...(failure !== undefined ? [`One didn't come off: ${failure || "the health log didn't answer"}.`] : []),
    ];
    return { text: parts.join(" "), calls, outputs };
}
const listOfNames = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
