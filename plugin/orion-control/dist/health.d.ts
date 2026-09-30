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
export interface HealthDayRecord {
    waterBottles: number;
    calories: number;
    supplementIDs: string[];
    recovery?: number;
    sleepPerformance?: number;
    sleepHours?: number;
    hrv?: number;
    restingHeartRate?: number;
    strain?: number;
    updatedAt: string;
}
export interface HealthLogFile {
    schema: "orion.health.v3";
    updatedAt: string;
    supplements: Supplement[];
    supplementLog: Record<string, string[]>;
    workouts: WorkoutSession[];
    calorieLog?: Record<string, number>;
    days?: Record<string, HealthDayRecord>;
    nutritionLog?: Record<string, unknown[]>;
    nutritionGoals?: Record<string, unknown>;
    [key: string]: unknown;
}
export declare function defaultHealthLogPath(configured?: string): string;
export declare function today(now?: Date): string;
export declare function readHealthLog(file: string): Promise<HealthLogFile>;
export declare function addSupplement(file: string, name: string, dose?: string, timeOfDay?: string): Promise<{
    added: boolean;
    supplement?: Supplement;
}>;
/**
 * Find one supplement by what Nick called it: exact name first, otherwise the
 * single entry whose name contains his words ("vitamin d" → "vitamin d3").
 * Two or more candidates is his decision, reported, never a guess.
 */
export declare function findSupplement(supplements: Supplement[], name: string): {
    match?: Supplement;
    ambiguous: Supplement[];
};
/**
 * Take a supplement off the list (2026-09-30). "Combine magnesium, zinc and
 * calcium into one" had no way to remove the singles, so ORION added the
 * combined item and said it had combined them. Past days keep their taken
 * records; only the list changes.
 */
export declare function removeSupplement(file: string, name: string): Promise<{
    removed?: Supplement;
    ambiguous: string[];
}>;
/** Rename a supplement or change its dose or time of day, keeping its id and history. */
export declare function updateSupplement(file: string, name: string, changes: {
    newName?: string;
    dose?: string;
    timeOfDay?: string;
}): Promise<{
    updated?: Supplement;
    ambiguous: string[];
    clash?: string;
}>;
/**
 * Mark a supplement taken today, by name.
 *
 * Adds it to the list if it is not there yet: being told "I took my magnesium"
 * about something Orion has never heard of should record the fact, not refuse
 * and ask for setup first.
 */
export declare function takeSupplement(file: string, name: string, now?: Date): Promise<{
    matched?: Supplement;
    created: boolean;
    alreadyTaken: boolean;
}>;
export declare function supplementStatus(file: string, now?: Date): Promise<{
    day: string;
    total: number;
    takenCount: number;
    supplements: {
        name: string;
        dose: string;
        timeOfDay: string;
        taken: boolean;
    }[];
}>;
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
export declare function logExercise(file: string, exercise: string, sets: LoggedSet[], unit?: string, now?: Date): Promise<{
    session: WorkoutSession;
    exercise: Exercise;
} | undefined>;
export declare function workoutStatus(file: string, now?: Date): Promise<{
    day: string;
    logged: boolean;
    title: string;
    totalSets: number;
    totalVolume: number;
    exercises: {
        name: string;
        sets: string[];
        volume: number;
    }[];
    previous: {
        day: string;
        exercises: {
            name: string;
            best: WorkoutSet;
        }[];
    }[];
}>;
