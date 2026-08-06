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
export declare function defaultHealthLogPath(configured?: string): string;
export declare function today(now?: Date): string;
export declare function readHealthLog(file: string): Promise<HealthLogFile>;
export declare function addSupplement(file: string, name: string, dose?: string, timeOfDay?: string): Promise<{
    added: boolean;
    supplement?: Supplement;
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
