import type { CalendarIntent } from "./calendar-intent.js";
import type { Day } from "./schedule-flow.js";
/** The add a move becomes, or undefined when this move is not that case. */
export declare function ownedMoveAsAdd(intent: CalendarIntent, day: Day): {
    intent: CalendarIntent;
    note: string;
} | undefined;
