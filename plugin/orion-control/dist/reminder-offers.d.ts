export type PendingOffer = {
    key: string;
    label: string;
    at: string;
    offeredAt: number;
    source: "chat" | "deadline";
};
export type OfferPort = {
    pending(): Promise<PendingOffer | null>;
    clear(key: string): Promise<void>;
    /** Remember an offer being made; false when it must not be made (the daily few are used, or this one was offered before). */
    record(offer: PendingOffer): Promise<boolean>;
};
export declare const MAX_OFFERS_PER_DAY = 3;
/** An offer is answered soon after it is made; a "yes" an hour and a half later is about something else. */
export declare const OFFER_WINDOW_MS: number;
/** The offers file, next to reminders.json. `now` is a seam for tests. */
export declare function fileOfferPort(dir: string, now?: () => Date): OfferPort;
export type Commitment = {
    label: string;
    at: string;
    when: string;
};
/** Something he says he has to do, with a day or part of a day to hang a reminder on; null for anything else. */
export declare function commitmentOf(message: string, now: Date): Commitment | null;
