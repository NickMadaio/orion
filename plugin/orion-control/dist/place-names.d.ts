export declare function knownPlaceNames(stateDir: string | undefined): string[];
/** Whether a name is one a known place answers to (the live known-places.json): an arrival reminder is never set for a place ORION cannot resolve. */
export declare function isKnownPlaceName(name: string, stateDir?: string): boolean;
