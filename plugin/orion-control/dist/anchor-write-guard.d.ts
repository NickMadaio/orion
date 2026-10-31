import type { DayBlock } from "./schedule-flow.js";
/** He named this block: its kind word ("gym", "study"/"studying"/"revision") or a distinctive word of its title. */
export declare function namesBlock(message: string, b: DayBlock): boolean;
/** The gym or study block this write would take or move without his naming it, or null when the write is fine. */
export declare function unnamedAnchorWrite(message: string, args: string[], blocks: DayBlock[]): DayBlock | null;
