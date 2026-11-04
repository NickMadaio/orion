export declare const FRESH_MS = 90000;
export declare const AWAY_IDLE_S = 300;
export type Activity = {
    version: 1;
    at: string;
    idleSeconds: number | null;
    app: {
        name: string;
        bundleId: string | null;
        pid: number;
    };
    category: string;
    window: string | null;
    url: string | null;
    domain: string | null;
    siteCategory: string | null;
    game: {
        name: string;
        since: string;
    } | null;
    focus: {
        active: boolean;
        task: string | null;
        allowedApps: string[];
        allowedDomains: string[];
    } | null;
};
export type HistoryRow = {
    at: string;
    bundleId: string | null;
    category: string;
    domain: string | null;
};
/** activity.json when it is a version 1 record written within FRESH_MS of `now`. */
export declare function readActivity(dir: string, now: Date): Activity | null;
export declare function readHistory(dir: string, now: Date, days?: number): HistoryRow[];
/** "playing Minecraft", "watching YouTube", "on Reddit", "in Xcode". */
export declare function phrase(a: Activity): string;
export declare const fmtMinutes: (mins: number) => string;
/** How long on this app or site: the game's own `since`, else the latest history row while it is the same thing. */
export declare function minutesOn(a: Activity, history: HistoryRow[], now: Date): number | null;
/** "Right now: playing Minecraft for 40 min". Null when nothing fresh is known. */
export declare function nowLine(a: Activity | null, history: HistoryRow[], now: Date): string | null;
export type Summary = {
    categories: Array<{
        category: string;
        minutes: number;
    }>;
    things: Array<{
        name: string;
        minutes: number;
    }>;
};
/** Per-row time is the gap to the next row, capped at 30 min (a closed lid is not hours of Safari); the last row runs to `now`. */
export declare function summarize(rows: HistoryRow[], now: Date, since: Date): Summary;
/** The day turns at 4 AM, like the rest of ORION. */
export declare function dayStart(now: Date): Date;
export type ActivityAsk = "now" | "today";
export declare function asksActivity(message: string): ActivityAsk | null;
/** First person, short enough to be spoken. */
export declare function nowReply(a: Activity | null, history: HistoryRow[], now: Date): string;
export declare function todayReply(rows: HistoryRow[], now: Date): string;
/** The reply for either question, read from the state directory. */
export declare function activityReply(ask: ActivityAsk, dir: string, now: Date): string;
