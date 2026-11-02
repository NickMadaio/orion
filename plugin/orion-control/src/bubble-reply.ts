/*
 A reply typed into the Mac's proactive bubble (W16-d, 2026-11-02: "I responded to a proactive message in the little bubble that pops
 up but his response didn't pop up").

 The app binds a bubble reply to the message it answers: the outreach id goes to orion-inbound-turn (--reply-to) and the gateway call,
 and an ask's id rides in the "[ORION context: …]" label as ", askId <id>." after the description. parseOutreach reads the rest of the
 label; this reads only the id, and only from inside the label, never from his own words. Pure: no I/O.
*/

const ASK_ID = /^[A-Za-z0-9._:-]{1,80}$/;

/** The ask id the app put in the ORION context label, or undefined when the label carries none (or there is no label). */
export function askIdOf(prompt: string): string | undefined {
  const label = prompt.match(/\[ORION context:([^\]]*)\]/)?.[1];
  const id = label?.match(/,\s*askId\s+([^\s.,;)]+(?:\.[^\s.,;)]+)*)\./)?.[1];
  return id && ASK_ID.test(id) ? id : undefined;
}
