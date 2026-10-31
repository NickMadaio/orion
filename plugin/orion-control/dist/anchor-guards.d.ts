/** tomorrow: at is the start he named, or the part of the day he gave ("tmrw morning" = 09:00, assumed: said back as an assumption). */
/** deferred: "ill do gym tmrw" (his plan), not "move gym to tomorrow" (an instruction). REV2 finding 8: a deferral while today's gym is
 *  still ahead deletes a gym day on an excuse, so the gym turn pushes back and asks instead of moving it. */
export type GymSkip = {
    kind: "excuse";
} | {
    kind: "legit";
    reason: string;
    at?: string;
} | {
    kind: "tomorrow";
    at?: string;
    assumed?: string;
    deferred?: boolean;
};
/** He is putting gym off. Null when it is not that (a question, a past report the reality flow owns, an explicit move with a time). */
export declare function readGymSkip(message: string): GymSkip | null;
/** One line of pushback, firmer when the week already shows skips or the now record says firm. Nothing is written. */
export declare function gymPushback({ skipsThisWeek, firm, gymAt }: {
    skipsThisWeek: number;
    firm: boolean;
    gymAt?: string;
}): string;
/** "ill do gym tmrw" while today's gym is still ahead: pushback and one question; nothing is written. */
export declare const deferAsk: (gymAt: string) => string;
export declare const legitAsk: (reason: string) => string;
export declare const legitLead: (reason: string) => string;
export declare const isWipe: (message: string) => boolean;
export declare const WIPE_CONFIRM = "That would take your classes and plans with people off too, so I haven't touched anything. I can clear just my own blocks instead: say \"clear the rest of today\", or name the day.";
