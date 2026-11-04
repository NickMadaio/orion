// w18 music: "play my music" is `orion-apps music play`, which opens or resumes a player. Held-out casual phrasings and the lookalikes that are not music.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAppsTurn } from "./apps-read.js";
import { argsFor } from "./apps-chat.js";
import { registerLocalRouting } from "./local-routing.js";
const play = { kind: "music", action: "play" };
describe("music turns", () => {
    it("play and resume", () => {
        for (const m of ["play my music", "play some music", "put on some music", "resume the music", "start my music", "pls play music", "can u play my music rn", "unpause the music",
            "play msuic", "put some music on", "play music", "turn on some music", "resume music pls", "play my spotify", "play spotify", "yo play some music"])
            expect(readAppsTurn(m), m).toEqual(play);
    });
    it("a playlist or artist, on a named player", () => {
        expect(readAppsTurn("play lofi beats on spotify")).toEqual({ kind: "music", action: "play", query: "lofi beats", player: "spotify" });
        expect(readAppsTurn("can you play my gym playlist")).toEqual({ kind: "music", action: "play", query: "gym" });
        expect(readAppsTurn("play some drake")).toEqual({ kind: "music", action: "play", query: "drake" });
        expect(readAppsTurn("pls play my study mix on apple music")).toEqual({ kind: "music", action: "play", query: "study mix", player: "music" });
        expect(readAppsTurn("play the weeknd on spotify pls")).toEqual({ kind: "music", action: "play", query: "the weeknd", player: "spotify" });
    });
    it("pause, skip, previous", () => {
        for (const m of ["pause music", "pause the music", "pause my music pls", "stop the music", "stop playing music", "pause spotify", "pause the song", "turn off the music", "pause msuic"])
            expect(readAppsTurn(m), m).toEqual({ kind: "music", action: "pause" });
        for (const m of ["skip", "skip this song", "next song", "next track", "skip this one", "skip song pls", "skip the song", "yo skip this"])
            expect(readAppsTurn(m), m).toEqual({ kind: "music", action: "skip" });
        for (const m of ["previous song", "go back a song", "last song", "play the previous track"])
            expect(readAppsTurn(m), m).toEqual({ kind: "music", action: "previous" });
    });
    it("lookalikes are not music turns", () => {
        for (const m of ["skip class", "skip the gym today", "skip my workout", "play minecraft", "play some games", "play with the dog", "i wanna play some fortnite", "pause the timer",
            "pause my focus session", "stop the alarm", "play it again", "next meeting", "whats my next class", "what music do i like", "stop the timer", "turn off the lights", "skip breakfast", "play some football later",
            "how do i play music on my phone", "can i skip dinner"])
            expect(readAppsTurn(m), m).toBeNull();
    });
    it("argsFor", () => {
        expect(argsFor({ kind: "music", action: "play" })).toEqual([["music", "play", "--json"]]);
        expect(argsFor({ kind: "music", action: "play", query: "lofi beats", player: "spotify" })).toEqual([["music", "play", "--player", "spotify", "lofi beats", "--json"]]);
        expect(argsFor({ kind: "music", action: "skip" })).toEqual([["music", "skip", "--json"]]);
    });
});
describe("through the routing", () => {
    it("play my music runs orion-apps music play; the desk's media tool never runs", async () => {
        const d = mkdtempSync(join(tmpdir(), "music-chat-"));
        writeFileSync(join(d, "health-log.json"), JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [] }));
        const handlers = new Map();
        const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
        const calls = [];
        const appsRun = async (a) => { calls.push(a); return { stdout: JSON.stringify({ ok: true, say: "Playing Spotify." }), code: 0 }; };
        registerLocalRouting(api, { warm: false, mode: "on", logPath: join(d, "r.jsonl"), progressDir: join(d, "tp"), stateDir: d, clock: () => "Tue 18:00", now: () => new Date(2026, 10, 3, 18, 0),
            decideImpl: async () => ({ move: "tool", tool: "media", args: { do: "play" }, say: "Playing your music now." }), brainSearch: async () => "",
            scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }), readDayJson: async () => undefined, readDeadlines: async () => ({ events: [], tasks: [] }),
            listReminders: async () => [], appsRun });
        const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
            o.push(await fn(e, c)); return o; };
        const ctx = { runId: "m-1", sessionKey: "agent:main:orion-chat-music" };
        await fire("before_model_resolve", { prompt: "play my music" }, ctx);
        const [direct] = (await fire("before_agent_reply", { cleanedBody: "play my music" }, ctx));
        expect(direct?.reply?.text).toBe("Playing Spotify.");
        expect(calls).toEqual([["music", "play", "--json"]]);
    });
});
