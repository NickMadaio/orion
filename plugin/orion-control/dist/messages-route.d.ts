export declare const CANNOT_EMAIL = "I can't send email yet \u2014 I can only read and search your Gmail. Nothing was sent.";
export declare const CANNOT_TEXT_SELF = "I can't text you yet \u2014 I can only send a text to someone you name, by contact or number, once you approve it. Nothing was sent.";
/** The fixed reply for a send ORION cannot do, or null. */
export declare function cannotSend(message: string): string | null;
/** Whether this turn is about reading his texts or email, or texting someone. */
export declare function isMessagesJob(message: string): boolean;
export declare const MESSAGES_NOTE: string;
