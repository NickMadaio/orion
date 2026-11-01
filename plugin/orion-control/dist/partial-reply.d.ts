import type { DayBlock } from "./schedule-flow.js";
/** "SHIFTED: Gym could not go at 18:00 (dinner with Annika is there) — booked 21:40 instead" by title: why it is not where it was asked. */
export declare function shiftReasons(lines: string[]): Map<string, {
    at: string;
    because: string;
}>;
/** Titles the scheduler cleared and that came back neither as a planned line nor as a NOT BOOKED one ("cleared 2 prior schedule blocks: Gym, Side project"). */
export declare function clearedNotReplanned(lines: string[], planned: string[], notBooked: string[]): string[];
/** "Classes and dinner with Annika stay put." from the fixed blocks the flow read, or "" when none are still ahead. */
export declare function keptLine(blocks: DayBlock[], nowHHMM: string | null): string;
/** What he hears when some of a run is booked and some did not fit. `did` are the booked items as already worded. */
export declare function partialReply(p: {
    did: string[];
    failures: string[];
    kept?: string;
    when?: string;
}): string;
/** A dry run that would drop the Gym (a must): the scheduler's own line naming it, else undefined. */
export declare function dropsGym(dryOutput: string): string | undefined;
