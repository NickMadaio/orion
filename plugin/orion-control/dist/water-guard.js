/*
 A removal never logs water (w20 r4, live gate 2026-11-05 #22 and #27).

 "nah i didnt eat that, take it off" and "remove the eggs" reached the worker, which ran `orion-log water 1` and `orion-log water 2 eggs on
 toast`: 3 bottles of water he never drank, and a reply that said it would "try again". Taking something off, removing, scrapping or saying
 he did not have it is never a report of drinking, so whatever the worker was told, an `orion-log water` call on such a turn does not run.
*/
const REMOVAL = /\b(?:take|took)\s+(?:it|that|this|them|those|the \w+)\s+(?:back\s+)?(?:off|out)\b|\b(?:remove|delete|scrap|scratch|undo|ditch|drop|cancel|erase|clear|untick|unlog|un-log|get rid of)\b|\b(?:didn'?t|didnt|did not|never|haven'?t|havent|wasn'?t|wasnt)\s+(?:actually\s+|even\s+)?(?:eat|ate|have|had|drink|drank)\b/i;
const SAYS_WATER = /\b(?:water|bottles?|hydrat\w*|drank|drink|drunk)\b/i;
const WATER_LOG = /\borion-log\s+water\b(?!-)/;
export const WATER_GUARD_REASON = "Orion water guard: Nick asked to take something off or said he didn't have it, which is never a water log. Do not run orion-log water. Tell him plainly that nothing was logged, and that you could not find what to take off if that is the case.";
/** The block reason when this exec would log water on a turn that was a removal; undefined when it is fine to run. */
export function waterLogBlock(message, command) {
    if (!WATER_LOG.test(command))
        return undefined;
    return REMOVAL.test(message) && !SAYS_WATER.test(message) ? WATER_GUARD_REASON : undefined;
}
