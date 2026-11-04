// Clock words shared by the sleep-plan and alarm flows. Pure.
/** "06:00" → "6:00"; "13:30" → "1:30". */
export const clock = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return `${(h % 12) || 12}:${String(m).padStart(2, "0")}`; };
/** "22:00" → "10pm"; "00:00" → "midnight"; "01:00" → "1am"; "22:45" → "10:45pm". */
export const meridiem = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    if (h === 0 && m === 0)
        return "midnight";
    return `${(h % 12) || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
};
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
