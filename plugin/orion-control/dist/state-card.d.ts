export declare const STALE_MS: number;
export declare const CARD_MAX_CHARS = 2400;
export type NowRecord = {
    schemaVersion: 1;
    computedAt: string;
    shouldBe?: {
        kind?: string;
        title?: string | null;
        start?: string;
        end?: string;
        why?: string;
    };
    is?: {
        activity?: string;
        place?: string | null;
        confidence?: string;
        focusSession?: {
            task?: string | null;
        } | null;
    };
    mismatch?: {
        kind?: string;
        since?: string;
        minutes?: number;
    } | null;
    next?: {
        kind?: string;
        title?: string | null;
        start?: string;
        leaveBy?: string;
    };
    strictness?: "flexible" | "firm";
};
export type DeclaredFact = {
    kind: string;
    text: string;
    at?: string;
    date?: string;
    title?: string;
    place?: string;
};
export type Slip = {
    date?: string;
    at?: string;
    planned?: {
        title?: string;
        kind?: string;
    };
    reason?: string;
};
export type Routine = {
    label?: string;
    kind?: string;
    weekdayName?: string;
    start?: number;
    end?: number;
    status?: string;
    confidence?: number;
};
export type Outreach = {
    text: string;
    at: string;
};
export type CardInputs = {
    now: Date;
    record: NowRecord | null;
    /** Why the record is not used, when it is not ("missing", "stale 3 h"). */
    recordGap?: string;
    declared: DeclaredFact[];
    slipsWeek: Slip[];
    routines: Routine[];
    lastOutreach: Outreach | null;
    essentials: string[];
    /** "Right now: playing Minecraft for 40 min" (activity.json, w19). Absent when nothing fresh is known. */
    activityLine?: string | null;
};
/** "1:30 PM" in the machine's zone (Europe/London on his Mac). */
export declare function clockOf(at: string | number | Date | undefined): string | null;
export declare const ordinal: (n: number) => string;
/** now.json when it is a schemaVersion 1 record computed within STALE_MS of `now`; otherwise null and why. */
export declare function readNowRecord(dir: string, now: Date): {
    record: NowRecord | null;
    gap?: string;
};
/** He said these today (declared-facts.json, schemaVersion 1). */
export declare function readDeclared(dir: string, now: Date): DeclaredFact[];
export declare function readSlipsWeek(dir: string, now: Date): Slip[];
export declare function readRoutines(dir: string): Routine[];
/** The last message ORION pushed to him (delivered, not held), within the last 6 hours. */
export declare function readLastOutreach(dir: string, now: Date): Outreach | null;
/** 3-5 lines from USER.md that change how ORION talks to him: priorities, school, times, how to sound. */
export declare function userEssentials(text: string | null, max?: number): string[];
/** The card the worker reads, under CARD_MAX_CHARS. Pure. */
export declare function stateCard(i: CardInputs): string;
/** One line for the front desk (it decides the move, it does not need the whole card). Pure. */
export declare function deskLine(i: CardInputs): string;
/** How to sound. Short and specific on purpose: the 9B copies long style guides back as boilerplate. */
export declare const TONE_NOTE: string;
/** Reads every input from the state dir and USER.md. Never throws. */
export declare function loadCardInputs({ stateDir, userMdPath, now }: {
    stateDir: string;
    userMdPath?: string;
    now: Date;
}): CardInputs;
