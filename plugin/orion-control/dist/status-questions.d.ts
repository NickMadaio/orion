/** "what am i supposed to be working on right now": the focus task, or else the block he is in. */
export declare const asksCurrentTask: (message: string) => boolean;
/** A focus-session status question names the session; "my nap block" is a calendar question, whatever the front desk chose. */
export declare const asksFocusStatus: (message: string) => boolean;
/** A front-desk draft without its claims about his day; "" when nothing is left to say. */
export declare function withoutDayClaims(draft: string): string;
