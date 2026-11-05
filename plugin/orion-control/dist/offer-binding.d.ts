/** Whether a stored retry slot may answer this "go": no newer offer in this chat took over, and a slot from another chat key is only a fresh one. */
export declare function slotAnswersGo(slotAt: number, newestOfferAt: number | undefined, crossKey: boolean, now: number): boolean;
/** The newest of the offers this chat still has open (undefined when none). */
export declare const newestOffer: (ats: ReadonlyArray<number | undefined>) => number | undefined;
