// "I'm ready to work": a focus session started from the plan, with the task's apps; finishing early; a one-time site override.
import { beforeEach, describe, expect, it } from "vitest";
import { isDoneMessage, isReadyMessage, readAppsReply, readEarlyAnswer, readSiteOverride, runFocusReady } from "./focus-ready.js";
const NOW = new Date(2026, 10, 4, 18, 5); // a Wednesday, 18:05
const day = (blocks) => ({ date: "2026-11-04", now: "18:05", blocks });
const RESUME = { title: "Finish resume", start: "18:00", end: "19:00", fixed: false, kind: "study" };
const LAB = { title: "CS lab 4", start: "19:30", end: "21:30", fixed: false, kind: "study" };
const DINNER = { title: "Dinner", start: "19:00", end: "19:30", fixed: false, kind: "meal" };
const PROFILES = {
    resume: [{ name: "Pages", bundleId: "com.apple.iWork.Pages" }, { name: "Safari", bundleId: "com.apple.Safari" }],
    lab: [{ name: "Visual Studio Code", bundleId: "com.microsoft.VSCode" }, { name: "Terminal", bundleId: "com.apple.Terminal" }, { name: "Safari", bundleId: "com.apple.Safari" }],
};
function world(over = {}) {
    const w = { session: over.session ?? { status: "none" }, calls: [], profileCalls: [], siteCalls: [], taskCalls: [], pending: undefined };
    const out = (o, code = 0) => ({ stdout: JSON.stringify(o), code });
    w.deps = {
        now: NOW, mayStart: over.mayStart ?? true,
        exec: async (args) => {
            w.calls.push(args);
            const [cmd] = args;
            if (cmd === "status")
                return out(w.session);
            if (cmd === "start") {
                if (over.startFails)
                    return { stdout: "orion-session: Orion is not running", code: 3 };
                const minutes = args.includes("--minutes") ? Number(args[args.indexOf("--minutes") + 1]) : 50;
                const sequence = args.includes("--sequence");
                w.session = { status: "running", phase: sequence ? "rest" : "focus", task: args[1], remainingSeconds: sequence ? 600 : Math.min(minutes, 50) * 60, blockNumber: 1, totalBlocks: 3, ok: true };
                return out(w.session);
            }
            if (cmd === "finish") {
                w.session = { status: "finished", ok: true };
                return out(w.session);
            }
            if (cmd === "arm")
                return out({ ok: true, enforcement: "gentle" });
            return out({ ok: true });
        },
        profile: async (args) => {
            w.profileCalls.push(args);
            if (args[0] === "pick")
                return out({ ok: true, apps: /lab|cs/i.test(args[1]) ? PROFILES.lab : PROFILES.resume, domains: ["docs.google.com"] });
            return out({ ok: true });
        },
        sites: async (args) => {
            w.siteCalls.push(args);
            if (args[0] === "show")
                return out({ active: true, allowedApps: ["com.apple.iWork.Pages", "com.apple.Safari"], task: w.session.task });
            if (args[0] === "allow")
                return out({ ok: true, domain: `${args[1]}.com` });
            return out({ ok: true });
        },
        tasks: async (args) => { w.taskCalls.push(args); return over.todosMatch === false ? { stdout: `NOTHING WAS CHANGED: no to-do called "${args[1]}"`, code: 1 } : { stdout: `Changed "${args[1]}": done (ticked off Orion).`, code: 0 }; },
        resolveApp: async (name) => (over.apps ? over.apps[name] ?? null : { canva: "com.canva.canvaeditor", preview: "com.apple.Preview", pages: "com.apple.iWork.Pages" }[name.toLowerCase()] ?? null),
        readDay: async () => over.day ?? day([RESUME, DINNER, LAB]),
        ...(over.deadlines ? { readDeadlines: over.deadlines } : {}),
        pending: { get: () => w.pending, set: (p) => { w.pending = p; } },
    };
    return w;
}
const reply = (r) => ("reply" in r ? r.reply : "text" in r ? r.text : "") ?? "";
beforeEach(() => undefined);
describe("ready phrases (held out, casual)", () => {
    it.each(["im ready to work", "ok im home lets work", "lets get started", "time to lock in", "ya im home. time to lock in", "ok ready to lock in lol", "alright lets get to work",
        "k im back, ready to work", "okay time to work", "im home lets lock in", "ready to work rn", "yo lets get to work orion", "ok lets lock in", "im ready to get to work"])("%s", (m) => {
        expect(isReadyMessage(m)).toBe(true);
    });
    it.each(["lets get started on dinner", "im ready to work out", "ready to work out lol", "lets work out", "im ready to work tomorrow", "are you ready to work?", "lets get started tomorrow",
        "im home", "lets hit the road", "time to lock the door", "ok im ready to go to bed", "time to work out", "lets get into it", "ready to work on the essay"])("not: %s", (m) => {
        expect(isReadyMessage(m)).toBe(false);
    });
});
describe("ready: picks the work from the plan, starts the session, allows the task's apps", () => {
    it("the current work block, first person, with allowed apps and the sites guard set", async () => {
        const w = world();
        const r = await runFocusReady("im ready to work", w.deps);
        expect(r.outcome).toBe("done");
        expect(reply(r)).toBe("Starting 50 min on Finish resume. Allowed: Pages and Safari. Need anything else?");
        expect(w.calls.find((c) => c[0] === "start")).toEqual(["start", "Finish resume", "--json"]);
        const arm = w.calls.find((c) => c[0] === "arm");
        expect(arm.join(" ")).toContain("--allow com.apple.iWork.Pages,com.apple.Safari");
        expect(w.siteCalls.find((c) => c[0] === "set")?.join(" ")).toContain("--task Finish resume");
        expect(w.pending).toMatchObject({ kind: "apps", task: "Finish resume" });
    });
    it("an old focus guard never survives into a new session: the sites are cleared first, then set", async () => {
        const w = world();
        await runFocusReady("im ready to work", w.deps);
        expect(w.siteCalls.map((c) => c[0]).slice(0, 2)).toEqual(["clear", "set"]);
    });
    it("when the apps cannot be armed the guard is still cleared, and nothing is set", async () => {
        const w = world();
        const base = w.deps.exec;
        w.deps.exec = async (a) => (a[0] === "arm" ? { stdout: "orion-session: nope", code: 1 } : base(a));
        await runFocusReady("im ready to work", w.deps);
        expect(w.siteCalls.map((c) => c[0])).toEqual(["clear"]);
    });
    it("a cs lab gets the editor, terminal and browser", async () => {
        const w = world({ day: day([{ ...LAB, start: "18:00", end: "20:00" }]) });
        expect(reply(await runFocusReady("lets get started", w.deps))).toBe("Starting 50 min on CS lab 4. Allowed: Visual Studio Code, Terminal and Safari. Need anything else?");
    });
    it("a block shorter than the standard 50 sets the session to the block", async () => {
        const w = world({ day: day([{ ...RESUME, start: "17:40", end: "18:35" }]) });
        await runFocusReady("time to lock in", w.deps);
        expect(w.calls.find((c) => c[0] === "start")).toEqual(["start", "Finish resume", "--minutes", "30", "--json"]);
    });
    it("no current block: the next work block today", async () => {
        const w = world({ day: day([DINNER, LAB]) });
        expect(reply(await runFocusReady("ok im home lets work", w.deps))).toMatch(/^Starting 50 min on CS lab 4\./);
    });
    it("no block at all: the nearest deadline", async () => {
        const w = world({ day: day([DINNER]), deadlines: async () => ({ events: [], tasks: [{ title: "Zim brief", due: "2026-11-06" }] }) });
        expect(reply(await runFocusReady("im ready to work", w.deps))).toMatch(/^Starting 50 min on Zim brief\./);
    });
    it("nothing in the plan: asks what to work on, once, and the next words start it", async () => {
        const w = world({ day: day([DINNER]) });
        const asked = await runFocusReady("im ready to work", w.deps);
        expect(asked).toMatchObject({ outcome: "say", kind: "ask" });
        expect(reply(asked)).toBe("What are we working on?");
        expect(w.calls.some((c) => c[0] === "start")).toBe(false);
        const started = await runFocusReady("the econ problem set", w.deps);
        expect(reply(started)).toMatch(/^Starting 50 min on the econ problem set\./);
    });
    it("an app that cannot be found is named, not silently dropped", async () => {
        const w = world();
        w.deps.profile = async () => ({ stdout: JSON.stringify({ ok: true, apps: [{ name: "Safari", bundleId: "com.apple.Safari" }, { name: "Zork", bundleId: null }], domains: [] }), code: 0 });
        const r = reply(await runFocusReady("im ready to work", w.deps));
        expect(r).toContain("Allowed: Safari.");
        expect(r).toContain("couldn't find Zork");
    });
    it("a session already running is never restarted", async () => {
        const w = world({ session: { status: "running", phase: "focus", task: "Finish resume", remainingSeconds: 1200 } });
        const r = await runFocusReady("im ready to work", w.deps);
        expect(reply(r)).toMatch(/already running/);
        expect(w.calls.some((c) => c[0] === "start")).toBe(false);
    });
    it("a start that fails says so and nothing is claimed", async () => {
        const w = world({ startFails: true });
        const r = await runFocusReady("im ready to work", w.deps);
        expect(reply(r)).toMatch(/couldn't start/);
        expect(reply(r)).not.toMatch(/^Starting/);
        expect(w.calls.some((c) => c[0] === "arm")).toBe(false);
    });
    it("room speech not addressed to ORION never starts anything", async () => {
        const w = world({ mayStart: false });
        expect((await runFocusReady("lets get started", w.deps)).outcome).toBe("fallback");
        expect(w.calls).toEqual([]);
    });
    it("not a ready phrase: falls through untouched", async () => {
        const w = world();
        expect((await runFocusReady("whats for dinner", w.deps)).outcome).toBe("fallback");
        expect(w.calls).toEqual([]);
    });
});
describe("the apps reply", () => {
    it.each([["also canva", ["canva"]], ["yeah i need canva and preview", ["canva", "preview"]], ["add canva, preview", ["canva", "preview"]], ["canva and preview", ["canva", "preview"]], ["and also use preview lol", ["preview"]]])("reads %s", (m, apps) => {
        expect(readAppsReply(m)).toEqual({ apps, none: false });
    });
    it.each(["nope", "nah thats it", "all good", "no", "thats all", "im good"])("%s means nothing more", (m) => {
        expect(readAppsReply(m)).toEqual({ apps: [], none: true });
    });
    it.each(["what time is it", "how long is left", "ok", "sounds good but also can you check my email later"])("not an apps reply: %s", (m) => expect(readAppsReply(m)).toBeNull());
    it("adds them to this session and to the task's profile", async () => {
        const w = world();
        await runFocusReady("im ready to work", w.deps);
        w.calls.length = 0;
        const r = await runFocusReady("also canva and preview", w.deps);
        expect(reply(r)).toBe("Added Canva and Preview for this session, and I'll remember them for Finish resume.");
        expect(w.calls.find((c) => c[0] === "arm")?.join(" ")).toContain("com.apple.iWork.Pages,com.apple.Safari,com.canva.canvaeditor,com.apple.Preview");
        expect(w.siteCalls.find((c) => c[0] === "add-apps")?.join(" ")).toContain("com.canva.canvaeditor,com.apple.Preview");
        expect(w.profileCalls.find((c) => c[0] === "remember")?.join(" ")).toContain("Finish resume --apps com.canva.canvaeditor,com.apple.Preview");
    });
    it("one it cannot find is said, the rest still added", async () => {
        const w = world();
        await runFocusReady("im ready to work", w.deps);
        const r = reply(await runFocusReady("also canva and zork", w.deps));
        expect(r).toContain("Added Canva");
        expect(r).toContain("couldn't find Zork");
    });
    it("no thanks closes the question and starts nothing", async () => {
        const w = world();
        await runFocusReady("im ready to work", w.deps);
        w.calls.length = 0;
        expect(reply(await runFocusReady("nope thats it", w.deps))).toBe("Locked in. Go.");
        expect(w.pending).toBeUndefined();
        expect(w.calls).toEqual([]);
    });
    it("an old question is gone: 'also canva' an hour later is not an apps reply", async () => {
        const w = world();
        await runFocusReady("im ready to work", w.deps);
        w.deps = { ...w.deps, now: new Date(NOW.getTime() + 3 * 3600_000) };
        expect((await runFocusReady("also canva", w.deps)).outcome).toBe("fallback");
    });
});
describe("finishing early", () => {
    const running = { status: "running", phase: "focus", task: "Finish resume", remainingSeconds: 1500 };
    it.each(["done", "im done", "finished the resume", "ok i finished", "done with the resume", "all done", "just finished lol", "done w the resume"])("%s", (m) => expect(isDoneMessage(m)?.ok).toBe(true));
    it.each(["done?", "am i done", "done for the day", "im done with dinner", "i havent finished", "when am i done", "not done yet", "i'm done for tonight"])("not: %s", (m) => expect(isDoneMessage(m)).toBeNull());
    it("asks once: break now, or the next task; the session is ended and the focus time kept", async () => {
        const w = world({ session: running });
        const r = await runFocusReady("done", w.deps);
        expect(reply(r)).toBe("Nice. Start your break now, or move to CS lab 4?");
        expect(r).toMatchObject({ outcome: "say", kind: "ask" });
        expect(w.calls.some((c) => c[0] === "finish")).toBe(true);
        expect(w.pending).toMatchObject({ kind: "early", task: "Finish resume", next: "CS lab 4" });
    });
    it("saying he finished the task ticks it off and says so", async () => {
        const w = world({ session: running });
        const r = reply(await runFocusReady("finished the resume", w.deps));
        expect(w.taskCalls[0]).toEqual(["done", "finish resume"]);
        expect(r).toBe('Nice, I ticked off "finish resume". Start your break now, or move to CS lab 4?');
    });
    it("a bare done does not claim the task is done", async () => {
        const w = world({ session: running });
        await runFocusReady("done", w.deps);
        expect(w.taskCalls).toEqual([]);
    });
    it("no next task: only the break is offered", async () => {
        const w = world({ session: running, day: day([RESUME]) });
        expect(reply(await runFocusReady("done", w.deps))).toBe("Nice. Start your break now?");
    });
    it("'break' starts the break (which hands back to the next task); the question is closed", async () => {
        const w = world({ session: running });
        await runFocusReady("done", w.deps);
        w.calls.length = 0;
        const r = await runFocusReady("break pls", w.deps);
        expect(w.calls.find((c) => c[0] === "start")).toEqual(["start", "CS lab 4", "--sequence", "10 break, 50 work", "--json"]);
        expect(reply(r)).toMatch(/^Break till 6:15 PM/);
        expect(w.pending).toBeUndefined();
    });
    it.each(["next task", "the lab", "move on", "lets go to the next one", "next"])("%s starts the next task with its profile", async (m) => {
        const w = world({ session: running });
        await runFocusReady("done", w.deps);
        w.calls.length = 0;
        const r = await runFocusReady(m, w.deps);
        expect(reply(r)).toMatch(/^Starting 50 min on CS lab 4\. Allowed: Visual Studio Code, Terminal and Safari\./);
        expect(w.calls.find((c) => c[0] === "start")?.[1]).toBe("CS lab 4");
    });
    it("'break and mark it done' ticks the task off too", async () => {
        const w = world({ session: running });
        await runFocusReady("done", w.deps);
        const r = reply(await runFocusReady("break, and mark it done", w.deps));
        expect(w.taskCalls[0]).toEqual(["done", "finish resume"]);
        expect(r).toMatch(/icked off/);
    });
    it("a todo that is not found is said honestly", async () => {
        const w = world({ session: running, todosMatch: false });
        const r = reply(await runFocusReady("finished the resume", w.deps));
        expect(r).not.toContain("ticked off");
        expect(r).toContain("couldn't find a to-do");
    });
    it("no thanks: done for now, nothing starts", async () => {
        const w = world({ session: running });
        await runFocusReady("done", w.deps);
        w.calls.length = 0;
        expect(reply(await runFocusReady("nah im done for now", w.deps))).toBe("Okay, you're done for now.");
        expect(w.calls).toEqual([]);
        expect(w.pending).toBeUndefined();
    });
    it("done with nothing running is not ours", async () => {
        const w = world();
        expect((await runFocusReady("done", w.deps)).outcome).toBe("fallback");
        expect(w.calls.some((c) => c[0] === "finish")).toBe(false);
    });
    it("'done with the gym' during a resume session is not about it", async () => {
        const w = world({ session: running });
        expect((await runFocusReady("done with the gym", w.deps)).outcome).toBe("fallback");
        expect(w.calls.some((c) => c[0] === "finish")).toBe(false);
    });
    it("a finish that fails says nothing was ended", async () => {
        const w = world({ session: running });
        const base = w.deps.exec;
        w.deps.exec = async (a) => (a[0] === "finish" ? { stdout: "orion-session: nope", code: 1 } : base(a));
        expect(reply(await runFocusReady("done", w.deps))).toMatch(/couldn't end/);
    });
    it("the Mac's Finish early button asks the same question: the answer finds the next task from the plan", async () => {
        const w = world();
        w.pending = { kind: "early", task: "Finish resume", askNext: true, marked: false, at: NOW.getTime() };
        const r = await runFocusReady("next", w.deps);
        expect(reply(r)).toMatch(/^Starting 50 min on CS lab 4\./);
        w.session = { status: "finished" };
        w.pending = { kind: "early", task: "Finish resume", askNext: true, marked: false, at: NOW.getTime() };
        expect(reply(await runFocusReady("break", w.deps))).toMatch(/^Break till 6:15 PM/);
    });
    it("answers read as", () => {
        expect(readEarlyAnswer("break", true)?.choice).toBe("break");
        expect(readEarlyAnswer("yes", true)?.choice).toBe("break");
        expect(readEarlyAnswer("the next one", true)?.choice).toBe("next");
        expect(readEarlyAnswer("next", false)).toBeNull();
        expect(readEarlyAnswer("nope", true)?.choice).toBe("end");
        expect(readEarlyAnswer("what is the weather", true)).toBeNull();
    });
});
describe("the one-time website override", () => {
    it.each([["i need youtube for this", "youtube"], ["i need youtube for the lecture", "youtube"], ["let me use reddit", "reddit"], ["allow youtube", "youtube"], ["ok i gotta use youtube for this", "youtube"], ["i have to use netflix.com", "netflix.com"]])("%s", (m, site) => {
        expect(readSiteOverride(m)).toBe(site);
    });
    it.each(["i need a break", "i need to eat", "whats on youtube", "i hate youtube", "block youtube", "i need coffee"])("not: %s", (m) => expect(readSiteOverride(m)).toBeNull());
    it("allows it for this session and says so", async () => {
        const w = world({ session: { status: "running", phase: "focus", task: "Finish resume", remainingSeconds: 1200 } });
        const r = await runFocusReady("i need youtube for this", w.deps);
        expect(w.siteCalls[0]).toEqual(["allow", "youtube", "--json"]);
        expect(reply(r)).toBe("Okay, youtube.com is allowed for the rest of this session.");
    });
    it("with no session there is nothing to allow and it is not ours", async () => {
        const w = world();
        expect((await runFocusReady("i need youtube for this", w.deps)).outcome).toBe("fallback");
        expect(w.siteCalls).toEqual([]);
    });
});
