/*
 The existing schedule suites (scripts/eval/schedule-scenarios.json, schedule-hard-2026-10-07.json) through the live layer: his
 sentence(s) go through the real routing with real local models, the real scheduler changes a sandbox day, and the day that is left
 is graded by scripts/lib/eval/schedule-grade.mjs, the same grader orion-eval-schedule uses.
*/
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { liveHooks } from "./live-backend.js";
import { Session } from "./turn.js";
const root = fileURLToPath(new URL("../../../../scripts/eval/", import.meta.url));
const FILES = ["schedule-scenarios.json", "schedule-hard-2026-10-07.json"];
const toMinute = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
export function loadScenarios() {
    return FILES.flatMap((f) => {
        const data = JSON.parse(readFileSync(join(root, f), "utf8"));
        const list = Array.isArray(data) ? data : data.scenarios;
        const base = Array.isArray(data) ? undefined : data.base;
        return list.map((s) => ({ ...s, now: s.now ?? base?.now, day: s.day ?? base?.day }));
    });
}
export async function runScheduleSuites(models, only) {
    const { gradeSchedule } = (await import(new URL("../../../../scripts/lib/eval/schedule-grade.mjs", import.meta.url).href));
    const today = new Date().toLocaleDateString("en-CA");
    const rows = [];
    for (const s of loadScenarios().filter((x) => !only || only.includes(x.id))) {
        const day = { date: today, now: s.now ?? null, blocks: (s.day ?? []).map((b) => ({ title: b.title, start: b.start, end: b.end, fixed: Boolean(b.fixed), ...(b.kind ? { kind: b.kind } : {}) })) };
        const hooks = liveHooks(models, day);
        const session = new Session(`${today}T${s.now ?? "12:00"}`, "phone", false, {}, hooks);
        const started = Date.now();
        const replies = [];
        try {
            const readDay = () => JSON.parse(readFileSync(join(session.dir, "eval-calendar.json"), "utf8")).events
                .map((e) => { const a = new Date(e.start); const b = new Date(e.end); return { title: e.title, start: a.getHours() * 60 + a.getMinutes(), end: b.getHours() * 60 + b.getMinutes(), id: e.identifier, fixed: !e.orion }; })
                .sort((x, y) => x.start - y.start);
            const before = readDay();
            for (const say of [s.say].flat())
                replies.push((await session.turn(say, {}, 20_000)).reply);
            const grade = gradeSchedule({ after: readDay(), before, expect: s.expect ?? {}, now: toMinute(s.now ?? "12:00"), reply: replies.at(-1) ?? "", todos: [] });
            rows.push({ id: `sched:${s.id}`, ok: grade.ok, failures: grade.failures, ms: Date.now() - started, reply: replies.at(-1) ?? "" });
        }
        catch (error) {
            rows.push({ id: `sched:${s.id}`, ok: false, failures: [`harness threw: ${error instanceof Error ? error.message : String(error)}`], ms: Date.now() - started, reply: replies.at(-1) ?? "" });
        }
        finally {
            session.close();
        }
    }
    return rows;
}
