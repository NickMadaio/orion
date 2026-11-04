import type { SleepOutcome, SleepRun } from "./sleep-plan-flow.js";
import type { AlarmDay, AlarmReq } from "./alarm-read.js";
/** The wake date a request means: tomorrow (the coming morning), today, a weekday word (the CLI picks the next), or the next time that clock comes round. */
export declare function wakeDateArg(day: AlarmDay | undefined, time: string, now: Date): string;
/** "tomorrow", "today", "Saturday", or "Saturday 7 Nov" when it is more than a few days out. */
export declare function dayLabel(date: string, now: Date): string;
/** One alarm request, end to end. `now` is the plugin clock. */
export declare function runAlarmTurn(req: AlarmReq, { run, now }: {
    run: SleepRun;
    now: Date;
}): Promise<SleepOutcome>;
