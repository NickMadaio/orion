export type Correction = {
    wrong?: string;
    right?: string;
    other?: boolean;
};
/** The correction in his message, or null. */
export declare function readCorrection(message: string): Correction | null;
/** His previous message with the correction attached, for the same flow to read. */
export declare function correctedAsk(previous: string, c: Correction): string;
