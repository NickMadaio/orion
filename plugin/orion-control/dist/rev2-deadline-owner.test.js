// REV2 finding 3 (2026-10-31): "my brother got a midterm friday at 2" put a fixed event on Nick's calendar, because the day-request reader
// ran before the someone-else check and DEADLINE accepted a bare "got" anywhere. Titles also kept a lone article ("A quiz").
import { describe, expect, it } from "vitest";
import { readDayRequest } from "./day-requests.js";
import { readReality } from "./reality.js";
const now = new Date(2026, 9, 31, 14, 0);
describe("finding 3: someone else's deadline is not his", () => {
    it.each(["my brother got a midterm friday at 2", "my sister has a quiz thursday at 9", "lol my roommate got an exam monday at 10",
        "she got a quiz friday at 2", "my roommate has a quiz thursday at 9 so he needs to study"])("%s", (m) => {
        expect(readDayRequest(m, now)).toBeNull();
        expect(readReality(m, now)?.reality.kind ?? null).not.toBe("request");
    });
    it.each([["got a quiz friday at 2", "Quiz"], ["i have a marketing quiz thursday at 2", "Marketing quiz"], ["add a quiz thursday at 9", "Quiz"],
        ["ive got an econ midterm friday at 2", "Econ midterm"], ["add the quiz monday at 10", "Quiz"]])("%s is his, titled %s", (m, title) => {
        expect(readDayRequest(m, now)).toMatchObject({ kind: "deadline", title });
    });
});
