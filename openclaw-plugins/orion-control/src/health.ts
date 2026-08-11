import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

/*
 The supplement and workout store, from the plugin's side.

 Same file the Orion app reads — `~/.openclaw/orion-controlled/health-log.json`
 — and the same contract the reminder store already uses: read, modify, write by
 atomic rename. That single shared file is the whole reason "I took my
 ashwagandha" and a tick in the dashboard are the same act rather than two
 systems to keep in sync.

 Kept read-modify-write on every call rather than caching. Two writers exist
 (this and the app), the file is tiny, and a cache here would be a way to
 silently clobber whatever the user just did in the UI.

 Read-modify-write from two processes is not made safe by the atomic rename.
 The rename stops a reader seeing half a file; it does nothing about a LOST
 UPDATE, where both sides read the same state, each edits its own corner, and
 the second rename erases the first one's change. Nick ticks a supplement in the
 dashboard, says "took my magnesium" a second later, and the tick is gone with
 nothing logged anywhere.

 Measured, not asserted — `native/Orion/Tests/run-race-test.sh` runs this file
 and the real Swift store against one scratch file and counts survivors. Without
 the lock, four seconds of both writers flat out lost 1965 of 5725 updates (34%);
 over three runs the loss ranged 27–38%. With it, 0 of 2187 and 0 of 4062, with
 nothing refused. The app fares worst unlocked — 284 of its 908 writes survived —
 because node cycles about five times faster, so in practice it is Nick's UI
 edits that lose to the voice path.

 So `mutate` holds `<file>.lock` across the whole cycle and re-reads inside it.
 The protocol — `<path>.lock`, O_EXCL create, break after 15s, give up after 6s
 — is the one `scripts/orion-notify` and `scripts/orion-remote` already use for
 remote.json, and it is mirrored exactly in `native/Orion/Sources/Orion/FileLock.swift`.
 The lockfile NAME is the contract: if the two sides ever disagree about it,
 both locks still "work" and neither excludes anything. Change one, change both.
*/

export interface Supplement {
  id: string;
  name: string;
  dose: string;
  timeOfDay: string;
}

export interface WorkoutSet {
  id: string;
  weight: number;
  reps: number;
  unit: string;
}

export interface Exercise {
  id: string;
  name: string;
  sets: WorkoutSet[];
}

export interface WorkoutSession {
  id: string;
  day: string;
  startedAt: string;
  title: string;
  exercises: Exercise[];
  notes: string;
}

export interface HealthLogFile {
  schema: "orion.health.v1";
  updatedAt: string;
  supplements: Supplement[];
  supplementLog: Record<string, string[]>;
  workouts: WorkoutSession[];
}

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
function emptyLog(): HealthLogFile {
  return {
    schema: "orion.health.v1",
    updatedAt: new Date(0).toISOString(),
    supplements: [],
    supplementLog: {},
    workouts: [],
  };
}

export function defaultHealthLogPath(configured?: string): string {
  return configured
    ? path.resolve(configured)
    : path.join(os.homedir(), ".openclaw", "orion-controlled", "health-log.json");
}

export function today(now = new Date()): string {
  // Local date, not UTC: a workout at 11pm belongs to that day, not tomorrow.
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function readHealthLog(file: string): Promise<HealthLogFile> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as HealthLogFile;
    if (parsed?.schema !== "orion.health.v1") return emptyLog();
    return {
      ...emptyLog(),
      ...parsed,
      supplements: Array.isArray(parsed.supplements) ? parsed.supplements : [],
      supplementLog: parsed.supplementLog ?? {},
      workouts: Array.isArray(parsed.workouts) ? parsed.workouts : [],
    };
  } catch {
    return emptyLog();
  }
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
async function withHealthLock<T>(file: string, body: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await (await open(lock, "wx")).close();
      try {
        return await body();
      } finally {
        await rm(lock, { force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
      const age = await stat(lock)
        .then((info) => Date.now() - info.mtimeMs)
        .catch(() => Infinity);
      if (age > 15_000) await rm(lock, { force: true });
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
async function writeHealthLog(file: string, log: HealthLogFile): Promise<HealthLogFile> {
  const stamped: HealthLogFile = { ...log, updatedAt: new Date().toISOString() };
  const temporary = `${file}.tmp-${randomBytes(4).toString("hex")}`;
  await writeFile(temporary, `${JSON.stringify(stamped, null, 2)}\n`, { mode: 0o600 });
  // Rename rather than overwrite: the app polls this file, and a partial read
  // of a half-written JSON blob is the one failure mode worth designing out.
  await rename(temporary, file);
  return stamped;
}

async function mutate(
  file: string,
  change: (log: HealthLogFile) => void,
): Promise<HealthLogFile> {
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

export async function addSupplement(
  file: string,
  name: string,
  dose = "",
  timeOfDay = "anytime",
): Promise<{ added: boolean; supplement?: Supplement }> {
  const trimmed = name.trim();
  if (!trimmed) return { added: false };
  let supplement: Supplement | undefined;
  let added = false;
  await mutate(file, (log) => {
    const existing = log.supplements.find(
      (entry) => entry.name.toLowerCase() === trimmed.toLowerCase(),
    );
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
 * Mark a supplement taken today, by name.
 *
 * Adds it to the list if it is not there yet: being told "I took my magnesium"
 * about something Orion has never heard of should record the fact, not refuse
 * and ask for setup first.
 */
export async function takeSupplement(
  file: string,
  name: string,
  now = new Date(),
): Promise<{ matched?: Supplement; created: boolean; alreadyTaken: boolean }> {
  const trimmed = name.trim();
  if (!trimmed) return { created: false, alreadyTaken: false };
  const day = today(now);
  let matched: Supplement | undefined;
  let created = false;
  let alreadyTaken = false;
  await mutate(file, (log) => {
    let entry = log.supplements.find(
      (candidate) => candidate.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (!entry) {
      entry = { id: randomUUID(), name: trimmed, dose: "", timeOfDay: "anytime" };
      log.supplements.push(entry);
      created = true;
    }
    matched = entry;
    const taken = log.supplementLog[day] ?? [];
    if (taken.includes(entry.id)) {
      alreadyTaken = true;
    } else {
      taken.push(entry.id);
      log.supplementLog[day] = taken;
    }
  });
  return { ...(matched ? { matched } : {}), created, alreadyTaken };
}

export async function supplementStatus(file: string, now = new Date()) {
  const log = await readHealthLog(file);
  const taken = new Set(log.supplementLog[today(now)] ?? []);
  return {
    day: today(now),
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

// MARK: Workouts

export interface LoggedSet {
  weight: number;
  reps: number;
}

/**
 * Record one exercise's sets into today's session.
 *
 * Takes the whole set list at once because that is how it gets said out loud:
 * "incline chest, 135 for 8, 145 for 6, 155 for 4" is one statement, and
 * splitting it into three tool calls invites two of them to succeed.
 */
export async function logExercise(
  file: string,
  exercise: string,
  sets: LoggedSet[],
  unit = "lb",
  now = new Date(),
): Promise<{ session: WorkoutSession; exercise: Exercise } | undefined> {
  const name = exercise.trim();
  if (!name || sets.length === 0) return undefined;
  const day = today(now);
  let result: { session: WorkoutSession; exercise: Exercise } | undefined;
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
    let target = session.exercises.find(
      (entry) => entry.name.toLowerCase() === name.toLowerCase(),
    );
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

export async function workoutStatus(file: string, now = new Date()) {
  const log = await readHealthLog(file);
  const day = today(now);
  const session = log.workouts.find((entry) => entry.day === day);
  const volume = (exercise: Exercise) =>
    exercise.sets.reduce((total, set) => total + set.weight * set.reps, 0);
  return {
    day,
    logged: session !== undefined,
    title: session?.title ?? "",
    totalSets: session?.exercises.reduce((total, e) => total + e.sets.length, 0) ?? 0,
    totalVolume: session?.exercises.reduce((total, e) => total + volume(e), 0) ?? 0,
    exercises:
      session?.exercises.map((exercise) => ({
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
        best: exercise.sets.reduce(
          (best, set) => (set.weight > best.weight ? set : best),
          exercise.sets[0] ?? { weight: 0, reps: 0, unit: "lb", id: "" },
        ),
      })),
    })),
  };
}

function previousSessions(log: HealthLogFile, day: string): WorkoutSession[] {
  return log.workouts
    .filter((entry) => entry.day !== day)
    .sort((left, right) => (left.day < right.day ? 1 : -1));
}
