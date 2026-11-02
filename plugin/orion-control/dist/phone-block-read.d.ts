export declare const GROUPS: readonly ["social", "browsers", "video", "games", "messaging"];
export type Group = (typeof GROUPS)[number];
/** How long: a length, a clock time as said, "the rest of the night" (until his wake alarm), or the rest of the day. */
export type Span = {
    minutes: number;
} | {
    clock: {
        h: number;
        m: number;
        meridiem: boolean;
    };
} | {
    night: true;
} | {
    day: true;
};
export type PhoneBlockRead = {
    kind: "block";
    groups: Group[];
    apps: string[];
    span?: Span;
    all?: true;
    distractions?: true;
} | {
    kind: "unblock";
    groups: Group[] | "all";
    apps: string[];
} | {
    kind: "ask";
    text: string;
};
export declare const MAX_MINUTES = 480;
export declare const DEFAULT_MINUTES = 60;
export declare const GROUP_LABEL: Record<Group, string>;
export declare const LIST_NAME: Record<Group, string>;
/** What "distracting stuff" means when he names no app: the feed, video and game groups. Browsers and messaging stay open (he may need them to study). */
export declare const DISTRACTION_GROUPS: Group[];
export declare const ASK_TEXT = "Which ones, social media, browsers, video, games or messaging?";
/** How long he asked for; undefined when he did not say. */
export declare function spanOf(text: string): Span | undefined;
export type Resolved = {
    minutes: number;
    until: Date;
    note?: "default" | "capped";
} | {
    tooLong: number;
};
/** "12:00 PM" */
export declare const clockLabel: (d: Date) => string;
/** The span as minutes from `now` (and the instant it ends), or how long it is when that is over the 8-hour limit. `wake` is his next alarm, when the plan has one. */
export declare function resolveSpan(span: Span | undefined, now: Date, wake?: () => Date | undefined): Resolved;
/** Groups and app names in `text`, in the order said. */
export declare function targetsOf(text: string): {
    groups: Group[];
    apps: string[];
};
/** What he asked for about his phone's app groups; undefined when this is not that (the turn goes on unchanged). */
export declare function readPhoneBlock(message: string): PhoneBlockRead | undefined;
