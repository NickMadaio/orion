/*
 Which offer a bare "go" answers (w20 round 5, live gate 3 #30 #52). ORION can have several things open at once: a retry slot ("Say go and
 I'll retry it"), a web page offered ("want the web player?"), a build offer, a food offer ("Log it?"). A "go" belongs to whichever ORION said
 LAST in this chat. The retry slot used to win regardless, and a slot left under ANOTHER chat key (the phone sends one conversation under several)
 replayed an old refusal ("I haven't made anything like 'before'") over the offer he was actually answering.
*/
const CROSS_KEY_FRESH_MS = 3 * 60_000;

/** Whether a stored retry slot may answer this "go": no newer offer in this chat took over, and a slot from another chat key is only a fresh one. */
export function slotAnswersGo(slotAt: number, newestOfferAt: number | undefined, crossKey: boolean, now: number): boolean {
  if (newestOfferAt !== undefined && newestOfferAt >= slotAt) return false   // an offer made in the same reply as the slot counts as newer;
  return !(crossKey && now - slotAt > CROSS_KEY_FRESH_MS);
}

/** The newest of the offers this chat still has open (undefined when none). */
export const newestOffer = (ats: ReadonlyArray<number | undefined>): number | undefined => {
  const live = ats.filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  return live.length ? Math.max(...live) : undefined;
};
