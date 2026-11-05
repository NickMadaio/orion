import type { Reminder } from "./ambient.js";
export declare function addTimerEntry(file: string, seconds: number, label: string, now?: number): Promise<Reminder>;
