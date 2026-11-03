// w14 g-food: which chat turns are food estimates, and what a short reply to "Log it?" means. Pure.
import { describe, expect, it } from "vitest";
import { readFoodTurn } from "./food-read.js";
const NOW = new Date(2026, 10, 2, 13, 0);
const read = (m, o = {}) => readFoodTurn(m, { now: NOW, mealsOn: true, ...o });
const offered = { pending: { at: NOW.getTime() - 60_000, via: "chat", offerText: "~670 kcal · 27P 99C 18F (chicken burrito and coke). Log it?" }, bound: true };
describe("asking for an estimate", () => {
    it.each([
        ["how many calories in a chicken burrito", "chicken burrito"],
        ["how many calories are in 2 slices of pepperoni pizza?", "2 slices of pepperoni pizza"],
        ["macros for 200g chicken breast and rice", "200g chicken breast and rice"],
        ["estimate the calories in my lunch: a big caesar salad and a coke", "big caesar salad and a coke"],
        ["how much protein is in greek yogurt with granola", "greek yogurt with granola"],
        ["i had a chicken burrito and a coke for lunch, how many calories is that", "i had a chicken burrito and a coke for lunch"],
    ])("%s", (m, text) => expect(read(m)).toEqual({ kind: "ask", text }));
    it("'how many calories was that' asks about the last meal", () => {
        expect(read("how many calories was that")).toEqual({ kind: "that" });
        expect(read("whats the macros on that?")).toEqual({ kind: "that" });
    });
    it("leaves his day totals and goals to the rest of ORION", () => {
        expect(read("how many calories have i had today")).toBeNull();
        expect(read("how much protein do i have left")).toBeNull();
        expect(read("whats my calorie goal")).toBeNull();
    });
});
describe("logging by description", () => {
    it.each([["log this: two eggs and toast", "two eggs and toast"], ["log a chicken caesar wrap", "a chicken caesar wrap"], ["track 2 bananas and a protein shake", "2 bananas and a protein shake"]])("%s", (m, text) => expect(read(m)).toEqual({ kind: "log", text }));
    it("never claims a workout, water, sleep or calendar log", () => {
        for (const m of ["log my workout", "log 2 bottles of water", "log my sleep", "log 3 hours of study", "track my weight"])
            expect(read(m)).toBeNull();
    });
});
describe("a meal he says he ate", () => {
    it("with a real food in it", () => expect(read("had a chicken burrito and a coke for lunch")?.kind).toBe("meal"));
    it("not without a food, and not when meals are off", () => {
        expect(read("had lunch")).toBeNull();
        expect(read("had a chicken burrito and a coke for lunch", { mealsOn: false })).toBeNull();
    });
});
describe("a reply to the offer", () => {
    it.each(["yes", "yeah log it", "log it", "sure", "yep!", "ok", "please do", "add it"])("%s is yes", (m) => expect(read(m, offered)).toEqual({ kind: "yes" }));
    it.each(["no", "nah", "don't log it", "no thanks", "skip it"])("%s is no", (m) => expect(read(m, offered)).toEqual({ kind: "no" }));
    it.each(["it was a small one", "no, it was a diet coke", "actually it was a large burrito", "there was no rice", "only half of it", "it was about 300g"])("%s re-estimates", (m) => expect(read(m, offered)).toEqual({ kind: "revise", correction: m }));
    it("'how many calories was that' repeats the offer", () => expect(read("how many calories was that", offered)).toEqual({ kind: "that" }));
    it("is not bound when another conversation came in between", () => {
        expect(read("yes", { ...offered, bound: false })).toBeNull();
        expect(read("it was a small one", { ...offered, bound: false })).toBeNull();
    });
    it("is not read into a calendar or unrelated request", () => {
        expect(read("move gym to 6", offered)).toBeNull();
        expect(read("remind me to call mom at 5", offered)).toBeNull();
    });
});
describe("a photo attached in chat", () => {
    it("is a photo turn when the words are about it", () => {
        for (const m of ["", "log this", "how many calories is this", "lunch"])
            expect(read(m, { attachments: [{ kind: "image" }] })).toEqual({ kind: "photo" });
    });
    it("other attachments are not", () => expect(read("log this", { attachments: [{ kind: "document" }] })).toBeNull());
});
describe("undo right after a food log", () => {
    const lastLogged = { id: "FOOD-0E0C7C2A-6B8B-4E0B-9C1A-3F7E3C0D8A11", at: NOW.getTime() - 2 * 60_000 };
    it("takes it off", () => expect(read("undo", { lastLogged })).toEqual({ kind: "undo", id: lastLogged.id }));
    it("not after ten minutes, and never without a food log", () => {
        expect(read("undo", { lastLogged: { ...lastLogged, at: NOW.getTime() - 11 * 60_000 } })).toBeNull();
        expect(read("undo")).toBeNull();
    });
});
describe("several offers waiting (wave 14 review): naming one is a pick", () => {
    const several = { pending: { at: NOW.getTime() - 60_000, via: "inbox", offerText: "Food photo: ~540 kcal. Log it?", count: 3, names: ["cheeseburger and fries", "caesar salad", "pasta bolognese"] }, bound: true };
    it.each([
        "the burger",
        "log the burger",
        // held out
        "yeah the salad",
        "just the pasta one",
        "the caesar salad pls",
        "both",
        "all of them",
        "log all 3",
        "the first one",
        "last one",
    ])("%s", (m) => expect(read(m, several)).toEqual({ kind: "pick", which: m }));
    it.each(["yes", "yeah log it"])("a bare yes is still a yes (the script asks which): %s", (m) => expect(read(m, several)).toEqual({ kind: "yes" }));
    it.each(["it was a small one", "the gym", "nah"])("not a pick: %s", (m) => expect(read(m, several)?.kind).not.toBe("pick"));
    it("with one offer waiting, a name is not a pick", () => expect(read("the burger", { ...several, pending: { ...several.pending, count: 1 } })?.kind).not.toBe("pick"));
});
describe("no and corrections that name one of several offers (wave 14 review)", () => {
    const several = { pending: { at: NOW.getTime() - 60_000, via: "inbox", offerText: "Food photo: ~540 kcal. Log it?", count: 3, names: ["cheeseburger and fries", "caesar salad", "pasta bolognese"] }, bound: true };
    it.each(["nah not the salad", "no dont log the pasta", "nope skip the fries", "forget the burger lol", "dont log the salad", "no the caesar one"])("%s drops only the named one", (m) => expect(read(m, several)).toEqual({ kind: "no", which: m }));
    it.each(["no", "nah", "dont log it", "skip it", "nope thanks"])("a bare %s with several waiting is a no with no name (the script asks)", (m) => expect(read(m, several)).toEqual({ kind: "no" }));
    it("with one waiting, a no needs no name", () => {
        expect(read("nah not the burger", { pending: { ...several.pending, count: 1, names: ["cheeseburger and fries"] }, bound: true })?.kind).toBe("no");
    });
    it("a correction that names an offer carries the name; one that does not, does not", () => {
        expect(read("the burger was a small one", several)).toEqual({ kind: "revise", correction: "the burger was a small one", which: "the burger was a small one" });
        expect(read("it was a small one", several)).toEqual({ kind: "revise", correction: "it was a small one" });
    });
    it("'no cheese on the burger' is a correction, not a no", () => expect(read("no cheese on the burger", several)?.kind).toBe("revise"));
    it("undo carries every id logged together", () => {
        const lastLogged = { id: "FOOD-b", ids: ["FOOD-a", "FOOD-b"], at: NOW.getTime() - 60_000 };
        expect(read("undo", { lastLogged })).toEqual({ kind: "undo", id: "FOOD-b", ids: ["FOOD-a", "FOOD-b"] });
    });
});
describe("a reply to a photo that was already logged", () => {
    const ID = "FOOD-0E0C7C2A-6B8B-4E0B-9C1A-3F7E3C0D8A11";
    const logged = { pending: { at: NOW.getTime() - 120_000, via: "inbox", offerText: "Logged ~630 kcal — pizza slice, pineapple topping: 36P 64C 25F. Fix anything?", loggedId: ID }, bound: true };
    it.each(["ya thats fine", "yep", "ok"])("%s is yes: it stays logged", (m) => expect(read(m, logged)).toEqual({ kind: "yes" }));
    it.each(["nah thats right", "no"])("%s is no: nothing to fix, it stays", (m) => expect(read(m, logged)).toEqual({ kind: "no" }));
    it.each(["undo", "nvm delete that", "remove it pls", "scratch that", "take it off"])("%s takes the entry off", (m) => expect(read(m, logged)).toEqual({ kind: "undo", id: ID }));
    it.each(["it was 2 slices", "no pineapple tho", "more like 800", "nah that was a veggie one", "i only ate half", "forgot the garlic bread", "was a small one", "make it 3 slices"])("%s edits it in place", (m) => expect(read(m, logged)).toEqual({ kind: "revise", correction: m }));
    it.each([["also had a coffee", "a coffee"], ["then i had a bagel", "a bagel"]])("%s is a new log, never an overwrite", (m, text) => expect(read(m, logged)).toEqual({ kind: "log", text }));
    it("chatter and other requests are neither an edit nor a log", () => {
        for (const m of ["lol thanks", "cool", "im not hungry", "i had a long day", "that was great", "just got home", "whats the weather", "remind me to call mom at 5", "move gym to 6"])
            expect(read(m, logged), m).toBeNull();
    });
    it("is not an edit once another conversation came in between", () => expect(read("it was 2 slices", { ...logged, bound: false })).toBeNull());
    describe("with an older open 'Log it?' offer too", () => {
        const both = { ...logged, pending: { ...logged.pending, count: 1, names: ["burger"] } };
        it("a yes or no answers the open question", () => {
            expect(read("yeah", both)).toEqual({ kind: "yes" });
            expect(read("nah", both)).toEqual({ kind: "no" });
        });
        it("a correction and an undo go to the logged entry", () => {
            expect(read("it was 2 slices", both)).toEqual({ kind: "revise", correction: "it was 2 slices" });
            expect(read("undo", both)).toEqual({ kind: "undo", id: ID });
        });
        it("with two open offers a bare yes still asks which (pick path), naming one picks it", () => {
            const two = { ...logged, pending: { ...logged.pending, count: 2, names: ["burger", "salad"] } };
            expect(read("the burger", two)).toEqual({ kind: "pick", which: "the burger" });
        });
    });
});
