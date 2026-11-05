export type AgendaEvent = {
    title: string;
    start: string;
};
export type AgendaDay = {
    date: string;
    events: AgendaEvent[];
};
export type AgendaRun = (date: string) => Promise<AgendaDay | undefined>;
/** The timed events of `orion-agenda day` output; the all-day and id lines are not events. */
export declare function parseAgenda(date: string, stdout: string): AgendaDay | undefined;
export declare const liveAgendaDay: AgendaRun;
export type Part = "morning" | "afternoon" | "evening" | "night";
/** "what did i have on yesterday evening" / "what was on last night": the day word and the part of it he asked about. */
export declare function readPastDayAsk(message: string): {
    day: "yesterday";
    part?: Part;
} | undefined;
/** The spoken answer for a past day, from what the calendar said. `dateLabel` is the day with its date ("Wednesday 4 Nov"). */
export declare function pastDayReply(agenda: AgendaDay | undefined, ask: {
    part?: Part;
}, dateLabel: string): string;
