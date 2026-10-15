/*
 Texts and email (live sweep 2026-10-15, q065-q071).

 The messages_* actions and the read-only Gmail scripts existed, but no local turn was told about
 them: "read my last 3 texts" read the manual index and then gave a Full Disk Access path from
 memory, "search gmail for the internship offer" said it cannot search Gmail, "any new emails from
 northeastern" blamed a focus session, and "email myself the list of my tasks" listed his to-dos and
 sent nothing. These are the routes.

   read    — his texts or his Gmail: the worker gets exactly those tools, read-only.
   send    — a text to someone he names: messages_send, which stays behind its own gates (tier,
             recipient in his own words, approval bound to recipient and body; see catalog.ts).
   cannot  — email (email_send is a simulation, the Gmail scripts cannot send) and a text to
             himself (orion-messages-send resolves only a contact or number he names, and the
             origin gate refuses a number he did not say): a fixed, honest line from code, so the
             worker cannot book a block or add a to-do in place of it.
*/

const POLITE = String.raw`^(?:(?:hey|ok(?:ay)?|so|please|pls|orion|can you|could you|would you)[,\s]+)*`;
/** "email myself …", "send prof an email …": an email he wants sent. */
const EMAIL_SEND = new RegExp(`${POLITE}(?:e-?mail\\b|send\\b.*\\be-?mail\\b)`, "i");
/** "text myself …", "send me a text …": a text to himself. */
const TEXT_SELF = new RegExp(`${POLITE}(?:(?:text|imessage|message)\\s+(?:me|myself)\\b|send\\s+(?:me|myself)\\s+(?:a\\s+)?(?:text|imessage|message)\\b)`, "i");
/** "text mom I'm late", "message carla …": a text to someone else. */
const TEXT_SEND = new RegExp(`${POLITE}(?:text|imessage|message)\\s+\\S|${POLITE}send\\b.*\\b(?:text|imessage)\\b`, "i");
/** Reading his texts or his email: "did anyone text me", "read my last 3 texts", "any new emails from …". */
const MESSAGES_READ = /\b(?:g-?mail|inbox|imessages?|texts|text messages?|e-?mails|(?:my|new|unread|latest|last) (?:e-?mail|mail|messages?|texts?)|(?:texted|messaged|e-?mailed|text|message) me)\b/i;
/** A to-do or a reminder that mentions email ("add a todo to email prof") is not a send. */
const NOT_MESSAGES = /\bto-?dos?\b|\bto do\b|\bremind|\breminder\b|\balarm\b/i;

export const CANNOT_EMAIL = "I can't send email yet — I can only read and search your Gmail. Nothing was sent.";
export const CANNOT_TEXT_SELF = "I can't text you yet — I can only send a text to someone you name, by contact or number, once you approve it. Nothing was sent.";

/** The fixed reply for a send ORION cannot do, or null. */
export function cannotSend(message: string): string | null {
  const m = message.trim();
  if (NOT_MESSAGES.test(m)) return null;
  if (EMAIL_SEND.test(m)) return CANNOT_EMAIL;
  if (TEXT_SELF.test(m)) return CANNOT_TEXT_SELF;
  return null;
}

/** Whether this turn is about reading his texts or email, or texting someone. */
export function isMessagesJob(message: string): boolean {
  const m = message.trim();
  if (NOT_MESSAGES.test(m)) return false;
  return TEXT_SEND.test(m) || MESSAGES_READ.test(m);
}

const SCRIPTS = "/Users/nickmadaio/Desktop/ORION/scripts";
export const MESSAGES_NOTE = [
  "This is about his texts or his email. Use only these tools for it:",
  "- His texts, with orion_task_run: messages_recent([limit]); messages_from(person, [limit]); messages_search(text, [limit]). Example: {\"steps\":[{\"action\":\"messages_recent\",\"limit\":3}]}.",
  `- His Gmail, read-only, with exec: ${SCRIPTS}/orion-gmail-search "<gmail query>" (like "from:northeastern is:unread" or "internship offer"); ${SCRIPTS}/orion-gmail-latest [--max N].`,
  "- A text to someone he names: orion_task_run messages_send(recipient, body), with the recipient exactly as he said it. It needs his approval: tell him it is waiting for his approval and give the code. Never say it was sent unless the result says \"Sent to\".",
  "You cannot send email and cannot text him himself: say so. Never book a calendar block, add a to-do or read the manual instead.",
  "Report only what the tool returned: who, what and when. If a tool fails (Full Disk Access, Gmail not signed in), say exactly what it said.",
].join("\n");
