/*
 An acknowledgement that implies a change nobody made (tube audit T3, 11-05: the desk drafted "Got it. Just the CS Lab reminder, not the new one." for a
 correction, with no tool run and an invented reminder). A front-desk ANSWER draft has no write behind it by construction, so for a message that asks for a
 change or corrects one, a draft that says "got it / done / updated / I moved ..." is never sent: the turn goes on to the lane that can actually do it
 (and say what happened). Pure.
*/
const ACK = /^\s*(?:got it|done|okay|ok|sure|noted|updated|all set|sorted|will do|on it|changed|moved|fixed|cancell?ed|removed|renamed|no problem|consider it done|absolutely|of course)\b|\b(?:i(?:'ve| have)?\s+(?:just\s+)?(?:updated|changed|moved|added|removed|renamed|set|fixed|cancell?ed|swapped|rescheduled)|has been (?:updated|changed|moved|removed)|is now (?:set|updated|moved|called|named))\b/i;
/** Whether the draft acknowledges (or claims) a change. */
export const ackImpliesChange = (draft) => ACK.test(draft);
