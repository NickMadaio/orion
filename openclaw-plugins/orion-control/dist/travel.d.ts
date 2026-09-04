export declare const TRIP_STORE: string;
export type Confidence = "known" | "observed" | "inferred" | "uncertain" | "unable_to_verify";
export interface TripLeg {
    kind: "flight" | "hotel" | "rail";
    /** What was matched, verbatim from the source. Never paraphrased. */
    reference: string;
    from?: string;
    to?: string;
    /** ISO date. Absent when the source did not carry one. */
    on?: string;
    confidence: Confidence;
    /** Which line of which message this came from, so it can be checked. */
    evidence: string;
}
export interface Trip {
    id: string;
    name: string;
    startsOn: string;
    endsOn: string;
    /** IANA zone at the destination, when it is known. */
    destinationZone?: string;
    legs: TripLeg[];
    createdAt: string;
}
export interface TripStore {
    version: 1;
    trips: Trip[];
}
export declare const EMPTY_TRIPS: TripStore;
/** A date in any of the shapes a confirmation writes, or null. */
export declare function parseLooseDate(text: string): string | null;
/**
 * Legs found in a block of message text.
 *
 * Returns CANDIDATES. Nothing here writes, and nothing here decides that a
 * message is genuine — every leg carries the line it came from so a person can
 * look, and every leg is `inferred` because a regex matched and nothing checked
 * it against an airline.
 */
export declare function detectLegs(messageText: string): TripLeg[];
export declare function validateTrip(value: unknown): string[];
/** Ask the runtime rather than a list. Wrong zones throw; that is the check. */
export declare function zoneExists(zone: string): boolean;
/**
 * The hour difference at a given instant, destination minus home.
 *
 * Computed at the trip's START rather than now, because that is when it
 * applies and because the two can differ: fly from New York to London in late
 * October and the gap is five hours on the way out and four on the way back.
 * A single "it is +5 there" is wrong for half the trip.
 */
export declare function zoneShiftHours(home: string, destination: string, at: Date): number | null;
/**
 * The travel brief.
 *
 * Says what is known, says what is merely inferred, and says the timezone shift
 * WITHOUT applying it. Every leg carries its evidence line, because a brief
 * assembled from untrusted email that cannot be checked is a brief that has to
 * be trusted.
 */
export declare function renderBrief(trip: Trip, options: {
    homeZone: string;
    now?: Date;
}): string;
