export type FixItem = {
    id: string;
    signature: string;
    title: string;
    status: string;
    offeredAt?: string;
    createdAt?: string;
    startedAt?: string;
    remindAt?: string;
    projectId?: string;
    diagnosis?: {
        failingExample?: {
            message?: string;
        };
    };
};
export declare const OFFER_ANSWER_MS: number;
export declare const REMINDER_ANSWER_MS: number;
export declare function readFixItems(stateDir: string): FixItem[];
/** The newest offer waiting for "now or later?", asked in the last 3 h. */
export declare const openOffer: (items: FixItem[], now: Date) => FixItem | undefined;
/** A parked project whose reminder fired in the last 6 h: "yes" to the reminder starts it. */
export declare const dueParked: (items: FixItem[], now: Date) => FixItem | undefined;
/** Any parked project (for "start the fix project" said unprompted). */
export declare const parkedAny: (items: FixItem[]) => FixItem | undefined;
