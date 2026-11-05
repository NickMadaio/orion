export declare const WATER_GUARD_REASON = "Orion water guard: Nick asked to take something off or said he didn't have it, which is never a water log. Do not run orion-log water. Tell him plainly that nothing was logged, and that you could not find what to take off if that is the case.";
/** The block reason when this exec would log water on a turn that was a removal; undefined when it is fine to run. */
export declare function waterLogBlock(message: string, command: string): string | undefined;
