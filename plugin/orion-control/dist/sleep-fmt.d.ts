/** "06:00" → "6:00"; "13:30" → "1:30". */
export declare const clock: (hhmm: string) => string;
/** "22:00" → "10pm"; "00:00" → "midnight"; "01:00" → "1am"; "22:45" → "10:45pm". */
export declare const meridiem: (hhmm: string) => string;
export declare const cap: (s: string) => string;
