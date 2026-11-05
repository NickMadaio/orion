/*
 One shared "retry it" slot (w20 review H3). Replies end a failure with "Say go and I'll retry it." and until now nothing kept that
 promise: a bare "go" reached the model as a bare word. Now the reply that offers a retry stores the message that failed, and a bare
 go / retry / try again within ten minutes runs that message again, so the real result comes back. Any other message clears the slot,
 so the most recent offer is always the one a "go" answers. Values only: every change returns a new slot.
*/
export const RETRY_WINDOW_MS = 10 * 60_000;
export const RETRY_OFFER = /\bsay go and i'?ll retry it\b/i;
/** What a reply says when it cannot keep that promise (no stored action to replay). */
export const NO_RETRY_LINE = "Ask me again and I'll retry.";
const RETRY_WORD = /^(?:(?:yeah|yes|yep|yup|ok|okay|sure|please)[\s,]+)?(?:go(?: ahead| again| on| for it)?|do it(?: again)?|try(?: it)? again|retry(?: it)?|have another go)[\s.!]*$/i;
/** A bare go-ahead for a retry ("go", "yeah go", "do it", "try again", "retry"), not a sentence that starts with one. */
export const isRetryWord = (text) => RETRY_WORD.test(text.trim());
/** A reply that says a change did not happen ("I couldn't add the call: ... Want me to try it a different way?"): his "try again" runs that message again (gate #54). */
export const FAILED_CHANGE = /^\s*(?:i\s+)?(?:couldn'?t|could not|can'?t|wasn'?t able|was not able|didn'?t manage)\b|\bnothing (?:was )?(?:changed|booked|moved|added)\b|\bso nothing is unchanged\b|\b(?:so|and) (?:it'?s|that part is) unchanged\b/i;
const NOT_A_CHANGE_ASK = /\?\s*$|^(?:what|when|why|how|who|where|is|are|do|does|did|can|could|which|whats|what's)\b/i;
/** The slot after a reply: set when it offers a retry, or says a change he asked for failed, for `message` (never for a retry word itself), else empty. */
export function afterReply(reply, message, now) {
    if (!message.trim() || isRetryWord(message))
        return undefined;
    if (RETRY_OFFER.test(reply) || (FAILED_CHANGE.test(reply) && !NOT_A_CHANGE_ASK.test(message.trim())))
        return { message, at: now };
    return undefined;
}
/** The message to run for this turn: the stored one when this is a fresh retry word, else what he typed. */
export function replayOf(slot, typed, now) {
    return slot && isRetryWord(typed) && now - slot.at < RETRY_WINDOW_MS ? slot.message : typed;
}
/** The reply with its retry promise taken out, for a reply that has nothing stored to replay. */
export const withoutRetryOffer = (reply) => reply.replace(/Say go and I'll retry it\./i, NO_RETRY_LINE);
