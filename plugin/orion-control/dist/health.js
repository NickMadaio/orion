import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
/**
 * A FUNCTION, not a shared constant.
 *
 * This was `const EMPTY = { supplements: [], ... }` with callers doing
 * `{ ...EMPTY }`. A spread is shallow, so every "fresh" log handed back the
 * SAME array instance — push a supplement into one health-log file and it
 * appeared in every other one opened in the same process. A test caught it
 * across two temp files; in production it would have been two dashboards, or
 * the app and the plugin sharing a process.
 */
function emptyLog() {
    return {
        schema: "orion.health.v3",
        updatedAt: new Date(0).toISOString(),
        supplements: [],
        supplementLog: {},
        workouts: [],
    };
}
export function defaultHealthLogPath(configured) {
    return configured
        ? path.resolve(configured)
        : path.join(os.homedir(), ".openclaw", "orion-controlled", "health-log.json");
}
export function today(now = new Date()) {
    // Local date, not UTC: a workout at 11pm belongs to that day, not tomorrow.
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
export async function readHealthLog(file) {
    let text;
    try {
        text = await readFile(file, "utf8");
    }
    catch (error) {
        if (error?.code === "ENOENT")
            return emptyLog();
        throw error;
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new Error("health-log.json is unreadable; refusing to replace it");
    }
    const schema = parsed.schema;
    if (!["orion.health.v1", "orion.health.v2", "orion.health.v3"].includes(String(schema))) {
        throw new Error(`unsupported health-log schema ${JSON.stringify(schema)}; refusing to replace it`);
    }
    /*
     The native app owns the current v3 contract. The plugin used to accept only
     v1, return an empty log for v3, then overwrite Nick's real supplements,
     nutrition and daily history on the next voice write. Accept known legacy
     versions, promote them to v3, and spread every unknown top-level field
     through untouched so app additions do not become plugin deletions.
    */
    return {
        ...emptyLog(),
        ...parsed,
        schema: "orion.health.v3",
        supplements: Array.isArray(parsed.supplements)
            ? parsed.supplements
            : [],
        supplementLog: parsed.supplementLog && typeof parsed.supplementLog === "object"
            ? parsed.supplementLog
            : {},
        workouts: Array.isArray(parsed.workouts) ? parsed.workouts : [],
        days: parsed.days && typeof parsed.days === "object"
            ? parsed.days
            : undefined,
    };
}
/**
 * Hold `<file>.lock` for the duration of `body`.
 *
 * Same shape as `withStateLock` in scripts/orion-notify, down to the numbers,
 * because the Swift app takes the SAME lockfile and the two only exclude each
 * other if they agree on the name and on what counts as stale.
 *
 * Breaking a lock older than 15s is what stops a process killed mid-write from
 * locking Nick out of his own supplements until he reboots. It is racy by
 * design — two processes can both judge the same lock dead — and that is the
 * accepted trade: 15s is far longer than any honest hold, so reaching it means
 * the holder is gone.
 */
async function withHealthLock(file, body) {
    const lock = `${file}.lock`;
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 60; attempt += 1) {
        try {
            await (await open(lock, "wx")).close();
            try {
                return await body();
            }
            finally {
                await rm(lock, { force: true });
            }
        }
        catch (error) {
            if (error?.code !== "EEXIST")
                throw error;
            const age = await stat(lock)
                .then((info) => Date.now() - info.mtimeMs)
                .catch(() => Infinity);
            if (age > 15_000)
                await rm(lock, { force: true });
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    throw new Error("health-log.json stayed locked for six seconds");
}
/**
 * Publish a new version of the log by atomic rename.
 *
 * The scratch file carries random bytes in its name, and the Swift side puts a
 * UUID in its own. A fixed `<file>.tmp` on both sides would be the SAME path in
 * the same directory, so the two processes would write one scratch file and race
 * to rename it — ENOENT here when the app renames ours away first, "couldn't be
 * saved" over there. The lock alone would prevent that; unique names mean a
 * broken stale lock cannot bring it back. Belt and braces, deliberately, because
 * the stale-break is the one path where two writers can legitimately overlap.
 *
 * Returns the log as written rather than mutating the caller's copy, so the
 * `updatedAt` a caller sees is the one that actually reached disk.
 */
async function writeHealthLog(file, log) {
    const stamped = { ...log, updatedAt: new Date().toISOString() };
    const temporary = `${file}.tmp-${randomBytes(4).toString("hex")}`;
    await writeFile(temporary, `${JSON.stringify(stamped, null, 2)}\n`, { mode: 0o600 });
    // Rename rather than overwrite: the app polls this file, and a partial read
    // of a half-written JSON blob is the one failure mode worth designing out.
    await rename(temporary, file);
    return stamped;
}
async function mutate(file, change) {
    return withHealthLock(file, async () => {
        // Re-read INSIDE the lock. This is the half that is easy to skip and the
        // only half that matters: a copy fetched before the lock was held is
        // precisely the stale copy whose write-back erases the app's edit.
        const log = await readHealthLog(file);
        change(log);
        return writeHealthLog(file, log);
    });
}
// MARK: Supplements
export async function addSupplement(file, name, dose = "", timeOfDay = "anytime") {
    const trimmed = name.trim();
    if (!trimmed)
        return { added: false };
    let supplement;
    let added = false;
    await mutate(file, (log) => {
        const existing = log.supplements.find((entry) => entry.name.toLowerCase() === trimmed.toLowerCase());
        if (existing) {
            supplement = existing;
            return;
        }
        supplement = { id: randomUUID(), name: trimmed, dose, timeOfDay };
        log.supplements.push(supplement);
        added = true;
    });
    return added ? { added, supplement } : { added: false, ...(supplement ? { supplement } : {}) };
}
/**
 * Find one supplement by what Nick called it: exact name first, otherwise the
 * single entry whose name contains his words ("vitamin d" → "vitamin d3").
 * Two or more candidates is his decision, reported, never a guess.
 */
export function findSupplement(supplements, name) {
    const wanted = name.trim().toLowerCase();
    if (!wanted)
        return { ambiguous: [] };
    const exact = supplements.find((entry) => entry.name.toLowerCase() === wanted);
    if (exact)
        return { match: exact, ambiguous: [] };
    const partial = supplements.filter((entry) => entry.name.toLowerCase().includes(wanted));
    return partial.length === 1 ? { match: partial[0], ambiguous: [] } : { ambiguous: partial };
}
/**
 * Take a supplement off the list (2026-09-30). "Combine magnesium, zinc and
 * calcium into one" had no way to remove the singles, so ORION added the
 * combined item and said it had combined them. Past days keep their taken
 * records; only the list changes.
 */
export async function removeSupplement(file, name) {
    let removed;
    let ambiguous = [];
    await mutate(file, (log) => {
        const found = findSupplement(log.supplements, name);
        ambiguous = found.ambiguous.map((entry) => entry.name);
        if (!found.match)
            return;
        removed = found.match;
        log.supplements = log.supplements.filter((entry) => entry.id !== found.match.id);
    });
    return removed ? { removed, ambiguous } : { ambiguous };
}
/** Rename a supplement or change its dose or time of day, keeping its id and history. */
export async function updateSupplement(file, name, changes) {
    let updated;
    let ambiguous = [];
    let clash;
    await mutate(file, (log) => {
        const found = findSupplement(log.supplements, name);
        ambiguous = found.ambiguous.map((entry) => entry.name);
        if (!found.match)
            return;
        const newName = changes.newName?.trim();
        if (newName && log.supplements.some((entry) => entry.id !== found.match.id && entry.name.toLowerCase() === newName.toLowerCase())) {
            clash = newName;
            return;
        }
        const next = {
            ...found.match,
            ...(newName ? { name: newName } : {}),
            ...(changes.dose !== undefined ? { dose: changes.dose } : {}),
            ...(changes.timeOfDay !== undefined ? { timeOfDay: changes.timeOfDay } : {}),
        };
        log.supplements = log.supplements.map((entry) => (entry.id === next.id ? next : entry));
        updated = next;
    });
    return { ...(updated ? { updated } : {}), ambiguous, ...(clash ? { clash } : {}) };
}
/**
 * Mark a supplement taken today, by name.
 *
 * Adds it to the list if it is not there yet: being told "I took my magnesium"
 * about something Orion has never heard of should record the fact, not refuse
 * and ask for setup first.
 */
export async function takeSupplement(file, name, now = new Date()) {
    const trimmed = name.trim();
    if (!trimmed)
        return { created: false, alreadyTaken: false };
    const day = today(now);
    let matched;
    let created = false;
    let alreadyTaken = false;
    await mutate(file, (log) => {
        let entry = log.supplements.find((candidate) => candidate.name.toLowerCase() === trimmed.toLowerCase());
        if (!entry) {
            entry = { id: randomUUID(), name: trimmed, dose: "", timeOfDay: "anytime" };
            log.supplements.push(entry);
            created = true;
        }
        matched = entry;
        const taken = log.supplementLog[day] ?? [];
        if (taken.includes(entry.id)) {
            alreadyTaken = true;
        }
        else {
            taken.push(entry.id);
            log.supplementLog[day] = taken;
        }
        // v3 readers prefer the day record over the legacy supplementLog. Keep
        // both populated while legacy clients still exist, or a voice-recorded
        // dose is on disk but invisible in the native dashboard.
        const days = log.days ?? {};
        const record = days[day] ?? {
            waterBottles: 0,
            calories: 0,
            supplementIDs: [],
            updatedAt: "",
        };
        if (!record.supplementIDs.includes(entry.id))
            record.supplementIDs.push(entry.id);
        record.updatedAt = now.toISOString();
        days[day] = record;
        log.days = days;
    });
    return { ...(matched ? { matched } : {}), created, alreadyTaken };
}
export async function supplementStatus(file, now = new Date()) {
    const log = await readHealthLog(file);
    const day = today(now);
    const taken = new Set(log.days?.[day]?.supplementIDs ?? log.supplementLog[day] ?? []);
    return {
        day,
        total: log.supplements.length,
        takenCount: taken.size,
        supplements: log.supplements.map((entry) => ({
            name: entry.name,
            dose: entry.dose,
            timeOfDay: entry.timeOfDay,
            taken: taken.has(entry.id),
        })),
    };
}
/**
 * Record one exercise's sets into today's session.
 *
 * Takes the whole set list at once because that is how it gets said out loud:
 * "incline chest, 135 for 8, 145 for 6, 155 for 4" is one statement, and
 * splitting it into three tool calls invites two of them to succeed.
 */
export async function logExercise(file, exercise, sets, unit = "lb", now = new Date()) {
    const name = exercise.trim();
    if (!name || sets.length === 0)
        return undefined;
    const day = today(now);
    let result;
    await mutate(file, (log) => {
        let session = log.workouts.find((entry) => entry.day === day);
        if (!session) {
            session = {
                id: randomUUID(),
                day,
                startedAt: now.toISOString(),
                title: "",
                exercises: [],
                notes: "",
            };
            log.workouts.push(session);
        }
        let target = session.exercises.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
        if (!target) {
            target = { id: randomUUID(), name, sets: [] };
            session.exercises.push(target);
        }
        for (const set of sets) {
            target.sets.push({
                id: randomUUID(),
                weight: set.weight,
                reps: set.reps,
                unit,
            });
        }
        result = { session, exercise: target };
    });
    return result;
}
export async function workoutStatus(file, now = new Date()) {
    const log = await readHealthLog(file);
    const day = today(now);
    const session = log.workouts.find((entry) => entry.day === day);
    const volume = (exercise) => exercise.sets.reduce((total, set) => total + set.weight * set.reps, 0);
    return {
        day,
        logged: session !== undefined,
        title: session?.title ?? "",
        totalSets: session?.exercises.reduce((total, e) => total + e.sets.length, 0) ?? 0,
        totalVolume: session?.exercises.reduce((total, e) => total + volume(e), 0) ?? 0,
        exercises: session?.exercises.map((exercise) => ({
            name: exercise.name,
            sets: exercise.sets.map((set) => `${set.weight}${set.unit} x ${set.reps}`),
            volume: volume(exercise),
        })) ?? [],
        // What the same lift looked like last time, which is the only number that
        // makes today's numbers mean anything.
        previous: previousSessions(log, day).slice(0, 3).map((entry) => ({
            day: entry.day,
            exercises: entry.exercises.map((exercise) => ({
                name: exercise.name,
                best: exercise.sets.reduce((best, set) => (set.weight > best.weight ? set : best), exercise.sets[0] ?? { weight: 0, reps: 0, unit: "lb", id: "" }),
            })),
        })),
    };
}
function previousSessions(log, day) {
    return log.workouts
        .filter((entry) => entry.day !== day)
        .sort((left, right) => (left.day < right.day ? 1 : -1));
}
