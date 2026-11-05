import { type MadeKind } from "./made-ledger.js";
export type LedgerAsk = {
    verb: "undo" | "remove";
    strong: boolean;
    /** Kinds he named outright (note, reminder, water, food, block); empty means any. */
    kinds: MadeKind[];
    /** One group of naming words per thing: "the stretch one and the careers one" is two. Empty for "that" / "undo". */
    targets: string[][];
    /** He pointed rather than named: "that", "the last one", "i just made". */
    pointing: boolean;
    /** "undo" and nothing else (or "undo that last move"): the newest change in this chat, whatever it was. */
    bare: boolean;
    /** His "yes" to a candidate ORION asked about: carry it out. */
    confirmed?: boolean;
    /** "put it all back", "undo everything": every calendar change of this chat, newest first. */
    all?: boolean;
    /** "i dont need the stretch reminder": a remark, not an order, so a reminder found only in the store is asked about first. */
    soft?: boolean;
    /** "revert that and the one before it": how many changes to take back (default 1). */
    count?: number;
    /** "get rid of every call with dad": every matching block ORION made, never his own. */
    every?: boolean;
};
/** The ledger's reading of his message, or null when it is not about undoing or removing something. */
export declare function readLedgerAsk(message: string): LedgerAsk | null;
/** "and the dentist one too": a new target for the removal he just made. Null when it is not that shape. */
export declare function readFollowUp(message: string): string[][] | null;
