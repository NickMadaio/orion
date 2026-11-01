import { type DayWord } from "./intent-time.js";
import type { Day } from "./schedule-flow.js";
/** One clause: the block it names, and either the block it goes after or the clock he said. */
export type CompoundPart = {
    verb: "move" | "add";
    name: string;
    after?: string;
    toSaid?: string;
    minutes?: number;
};
export type CompoundPlan = {
    kind: "run";
    argv: string[];
    title: string;
} | {
    kind: "say";
    say: "cannot" | "plain";
    text: string;
};
/** Each clause of a sentence with two or three changes, or undefined (one change, or a clause that does not read). `name` cleans a title. */
export declare function readCompound(text: string, name: (t: string) => string | undefined): CompoundPart[] | undefined;
/** The parts against the day: one `day --plan` argv for all of them, or the line that says why nothing changed. */
export declare function planCompound(parts: CompoundPart[], day: Day, which: DayWord): CompoundPlan;
