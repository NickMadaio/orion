import type { DayBlock } from "./schedule-flow.js";
export type NapGuess = {
    from: number;
    to: number;
    before?: DayBlock;
};
/** The nap's guessed span (minutes today): `length` long, ending now unless a fixed plan covers that time. */
export declare function napWindow(blocks: readonly DayBlock[], now: number, length: number, earliest?: number): NapGuess;
