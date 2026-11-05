/** What a turn that should be silent sends. The Mac app treats an empty reply as an error, so it is an ellipsis, said as nothing. */
export declare const QUIET_REPLY = "\u2026";
export declare const QUIET_FILE = "chat-quiet.json";
export declare const QUIET_DEFAULT_MIN = 30;
export declare const REPEAT_WINDOW_MS: number;
/** He said ORION's name: the turn is for ORION (and it ends a quiet window). */
export declare const addressed: (message: string) => boolean;
/** "dont reply unless i say orion", "shush", "i'm rehearsing a presentation for the next 20 minutes": minutes of quiet, or null. */
export declare function quietRequest(message: string): number | null;
export declare const quietAck: (minutes: number) => string;
/** The quiet window: in the state dir when there is one (the app, voice and every session share it), else in memory. */
export declare class QuietWindow {
    private readonly dir?;
    private memory;
    constructor(dir?: string | undefined);
    until(now: number): number | null;
    start(now: number, minutes: number, reason: string): void;
    end(now: number): void;
    private write;
}
/** Per session, the failure lines sent and when. `guard` returns what to send instead of a repeat.
 *  Typed and phone turns key a repeat on what he SAID (the same ask failing again), and get a different, more useful reply
 *  (the reason plus a concrete alternative), never a bare "…". Spoken turns also key on the failure line itself (R2's thirty
 *  rehearsal lines) and stay silent from the second repeat on. */
export declare class RepeatGuard {
    private readonly sent;
    guard(sessionKey: string | undefined, text: string, spoken: boolean, now?: number, message?: string): string;
}
export declare const ROOM_STREAK_MS: number;
/** A line that reads as said to a person in the room or on the phone. Only meaningful for a spoken line without "orion". */
export declare const talksToSomeoneElse: (message: string) => boolean;
export declare const requestShaped: (message: string) => boolean;
export declare const statusShaped: (message: string) => boolean;
/** Per session: when a spoken turn last went unanswered as not for ORION. */
export declare class RoomStreak {
    private readonly last;
    mark(sessionKey: string | undefined, now: number): void;
    recent(sessionKey: string | undefined, now: number): boolean;
    clear(sessionKey: string | undefined): void;
}
/** 2026-10-31 17:40 (build 1052): a body-cam video on the TV woke the app, and "insert at just the right point in the shoe … And then"
 *  was held as half a request: ORION said "Go on." to the television. Half a request to ORION is short ("can", "can you move gym to
 *  after my"); a long line that trails off with no request or status in it is someone else mid-sentence. The caller passes `trailing`. */
export declare const ROOM_FRAGMENT_WORDS = 8;
/** How a spoken line without "orion" is read: "room" (silent, nothing runs), "streak" (only a flow that acts may answer), or null. */
export declare function roomTalk(message: string, ctx: {
    spoken: boolean;
    streak: boolean;
    trailing?: boolean;
}): "room" | "streak" | null;
/** Inside a streak, a code reply that only asks or reports a failure is not said to a room that was not talking to ORION. */
export declare const roomQuiet: (text: string, kind?: string) => boolean;
