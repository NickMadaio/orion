export type BedChange = {
    time: string;
    scope: "tonight" | "always";
} | {
    shift: number;
    scope: "tonight" | "always";
};
/** The bedtime change in his message, or undefined. */
export declare function readBedtimeChange(message: string): BedChange | undefined;
