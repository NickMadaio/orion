// Wave 6 (2026-11-01, gate run-1101003318: kno-forget-v/c, kno-connections-c, per-who-am-i-c, saf-delete-folder-c).
// Phrasings are Nick-style and held out of scripts/eval/gate/scenarios/. The script runner is faked; the reply is built from its JSON.
import { describe, expect, it } from "vitest";
import { KnowledgePending, readKnowledgeMove } from "./knowledge-moves.js";
import { runKnowledgeMove } from "./knowledge-run.js";
function fake(answers) {
    const calls = [];
    const run = async (script, args) => {
        calls.push({ script, args });
        const out = answers(script, args);
        return out === undefined ? { stdout: "", code: 1 } : { stdout: JSON.stringify(out), code: 0 };
    };
    return { run, calls };
}
describe("readKnowledgeMove: forget", () => {
    it.each([
        ["can u forget the thing i said about my wifi password", ["my wifi password"]],
        ["erase what you remembered about priya pls", ["priya"]],
        ["delete that memory abt creatine its wrong", ["creatine"]],
        ["remove the saved entry Saved: Gym Bag and the one about my landlord", ["gym bag", "my landlord"]],
    ])("%s", (said, targets) => {
        const m = readKnowledgeMove(said);
        expect(m?.kind).toBe("forget");
        expect(m && m.kind === "forget" ? m.targets : []).toEqual(targets);
    });
    it.each([
        "forget about gym today",
        "dont let me forget to call mom",
        "i forgot my charger",
        "delete the gym block tomorrow",
        "forget it lets just do econ",
        "remove the reminder about laundry",
    ])("not a memory forget: %s", (said) => {
        expect(readKnowledgeMove(said)?.kind).not.toBe("forget");
    });
    it("plural words mean every match goes", () => {
        const m = readKnowledgeMove("wipe all the stuff you saved about my old job");
        expect(m).toMatchObject({ kind: "forget", targets: ["my old job"], all: true });
    });
});
describe("readKnowledgeMove: links", () => {
    it.each([
        ["whats connected to atlas", "atlas"],
        ["what links to econ1115 in my notes", "econ1115"],
        ["how does portsoken connect to my stuff", "portsoken"],
        ["show me what's tied to the marketing presentation?", "marketing presentation"],
    ])("%s", (said, subject) => {
        expect(readKnowledgeMove(said)).toEqual({ kind: "links", subject });
    });
    it.each(["move everything related to gym to tomorrow", "whats related to my stuff", "is this connected to wifi"])("not a links ask: %s", (said) => {
        expect(readKnowledgeMove(said)?.kind).not.toBe("links");
    });
});
describe("readKnowledgeMove: profile", () => {
    it.each(["tell me everything u know about me", "whats my usual routine look like", "describe me based on what you know", "how well do you know me", "who am i"])("%s", (said) => {
        expect(readKnowledgeMove(said)).toEqual({ kind: "profile" });
    });
    it.each(["whats my routine tomorrow", "who am i meeting at 3", "what do you know about annika"])("not a profile ask: %s", (said) => {
        expect(readKnowledgeMove(said)?.kind).not.toBe("profile");
    });
});
describe("readKnowledgeMove: trash", () => {
    it.each([
        ["trash old-notes.txt in my downloads", { kind: "trash", name: "old-notes.txt", folder: false, root: "downloads" }],
        ["move \"report draft.docx\" on my desktop to the bin", { kind: "trash", name: "report draft.docx", folder: false, root: "desktop" }],
        ["get rid of the folder called scratch in documents/tmp-stuff", { kind: "trash", name: "scratch", folder: true, root: "documents", within: "tmp-stuff" }],
        ["delete notes.md out of the misc folder", { kind: "trash", name: "notes.md", folder: false, within: "misc" }],
    ])("%s", (said, want) => {
        expect(readKnowledgeMove(said)).toEqual(want);
    });
    it.each(["clean up my documents folder", "delete the old stuff in documents", "delete my gym block"])("no named item, not a trash move: %s", (said) => {
        expect(readKnowledgeMove(said)?.kind).not.toBe("trash");
    });
    it("never from room speech", () => {
        expect(readKnowledgeMove("trash old-notes.txt in my downloads", { spoken: true })).toBeUndefined();
    });
});
describe("runKnowledgeMove: forget", () => {
    const entries = {
        "my wifi password": [{ id: "aaaaaaaaaa", text: "WiFi password is on the sticky note", where: "your \"Nick\" note", copies: 1 }],
        priya: [{ id: "bbbbbbbbbb", text: "DS lab partner is Priya", where: "your \"Nick\" note", copies: 1 }, { id: "cccccccccc", text: "Priya lent me a charger", where: "your journal for 2026-10-20", copies: 1 }],
    };
    const brain = (archived) => (script, args) => {
        if (args[0] !== "forget")
            return undefined;
        if (args[1] === "--apply") {
            archived.push(...args.slice(2));
            return { archived: args.slice(2).map((id) => ({ id, text: Object.values(entries).flat().find((e) => e.id === id).text, where: "x", copies: 1 })), missing: [] };
        }
        return { query: args[1], matches: entries[args[1]] ?? [] };
    };
    it("one match: archived, and the reply quotes exactly what went", async () => {
        const archived = [];
        const { run } = fake(brain(archived));
        const out = await runKnowledgeMove({ kind: "forget", targets: ["my wifi password"], all: false }, run);
        expect(archived).toEqual(["aaaaaaaaaa"]);
        expect(out.text).toContain("WiFi password is on the sticky note");
        expect(out.text).toMatch(/forgot/i);
    });
    it("nothing matches: says so and removes nothing", async () => {
        const archived = [];
        const { run } = fake(brain(archived));
        const out = await runKnowledgeMove({ kind: "forget", targets: ["the moon"], all: false }, run);
        expect(archived).toEqual([]);
        expect(out.text).toMatch(/nothing saved about "the moon"/i);
        expect(out.text).not.toMatch(/couldn't|error|exec|orion-brain/i);
    });
    it("several match a singular ask: lists them and asks which; a pick next turn archives only that one", async () => {
        const archived = [];
        const { run } = fake(brain(archived));
        const out = await runKnowledgeMove({ kind: "forget", targets: ["priya"], all: false }, run);
        expect(archived).toEqual([]);
        expect(out.text).toMatch(/1\) DS lab partner is Priya/);
        expect(out.text).toMatch(/2\) Priya lent me a charger/);
        expect(out.text).toMatch(/which/i);
        expect(out.held?.kind).toBe("forget-pick");
        const pick = readKnowledgeMove("the second one", { held: out.held });
        expect(pick?.kind).toBe("forget-pick");
        const done = await runKnowledgeMove(pick, run);
        expect(archived).toEqual(["cccccccccc"]);
        expect(done.text).toContain("Priya lent me a charger");
        expect(done.text).not.toContain("DS lab partner");
    });
    it("two targets in one ask, one with nothing saved: forgets the one, says the other had nothing", async () => {
        const archived = [];
        const { run } = fake(brain(archived));
        const out = await runKnowledgeMove({ kind: "forget", targets: ["the moon", "my wifi password"], all: false }, run);
        expect(archived).toEqual(["aaaaaaaaaa"]);
        expect(out.text).toContain("WiFi password");
        expect(out.text).toMatch(/nothing saved about "the moon"/i);
    });
    it("the store is unreachable: an honest line, no internals", async () => {
        const { run } = fake(() => undefined);
        const out = await runKnowledgeMove({ kind: "forget", targets: ["priya"], all: false }, run);
        expect(out.text).toMatch(/couldn't reach/i);
        expect(out.text).toMatch(/nothing was removed/i);
        expect(out.text).not.toMatch(/exec|orion-brain|lookup/i);
    });
});
describe("runKnowledgeMove: links and profile", () => {
    it("links: said as connections, from the relations", async () => {
        const { run } = fake(() => ({ subject: "cs3000", found: true, title: "CS3000", type: "course", facts: [], links: [
                { label: "CS3000 Midterm", kind: "has_assessment", dir: "out", type: "assessment", via: "note" },
                { label: "Ada Lovelace", kind: "instructor", dir: "out", type: "person", via: "note" },
                { label: "CS3001", kind: "lab_for", dir: "in", type: "course", via: "note" },
                { label: "Nick", kind: "takes", dir: "in", type: "person", via: "graph" },
            ] }));
        const out = await runKnowledgeMove({ kind: "links", subject: "cs3000" }, run);
        expect(out.text).toBe("CS3000 links to: CS3000 Midterm (assessment), Ada Lovelace (instructor), CS3001 (lab for it), Nick (takes it).");
    });
    it("links: a missing node is said plainly", async () => {
        const { run } = fake(() => ({ subject: "zebra club", found: false, facts: [], links: [] }));
        const out = await runKnowledgeMove({ kind: "links", subject: "zebra club" }, run);
        expect(out.text).toBe("I don't have anything called \"zebra club\" in your notes or knowledge graph.");
    });
    it("profile: classes, gym, side project, home and priorities lead; trivia after", async () => {
        const { run } = fake(() => ({ name: "Nick Madaio", school: "Northeastern University London", classes: ["CS3000", "ECON1"], gym: "90 min every day (a must, never dropped)", sideProject: "at least 1 hour a day",
            priorities: "classes → gym → study", home: "London", commute: "15 min commute to Office", builds: ["Atlas"], working: [], trivia: ["Falls asleep around 1:00 AM"], learned: ["Nick is allergic to peanuts"] }));
        const out = await runKnowledgeMove({ kind: "profile" }, run);
        const t = out.text;
        for (const bit of ["CS3000", "ECON1", "90 min every day", "at least 1 hour a day", "London", "classes → gym → study", "Atlas"])
            expect(t).toContain(bit);
        expect(t.indexOf("fall asleep around 1:00 AM")).toBeGreaterThan(t.indexOf("classes → gym → study"));
        expect(t.indexOf("peanuts")).toBeGreaterThan(t.indexOf("CS3000"));
        expect(t).toContain("You've also told me: you're allergic to peanuts.");
    });
});
describe("runKnowledgeMove: trash", () => {
    const junk = { path: "/h/Documents/zz/junk.txt", shown: "Documents/zz/junk.txt", name: "junk.txt", kind: "file", exact: true };
    const folder = { path: "/h/Documents/zz/old", shown: "Documents/zz/old", name: "old", kind: "folder", items: 3 };
    it("a file he named: moved to the Trash with a confirmation naming it, and the reply says so", async () => {
        const { run, calls } = fake((_s, args) => (args[0] === "find" ? { name: "junk.txt", matches: [junk] } : { ok: true, from: junk.shown, to: "/h/.Trash/junk.txt", id: "x" }));
        const out = await runKnowledgeMove({ kind: "trash", name: "junk.txt", folder: false, root: "documents", within: "zz" }, run);
        expect(calls[0]).toEqual({ script: "orion-trash", args: ["find", "junk.txt", "--root", "documents", "--in", "zz"] });
        expect(calls[1]).toEqual({ script: "orion-trash", args: ["move", junk.path, "--confirm", "junk.txt"] });
        expect(out.text).toBe("Moved junk.txt (Documents/zz) to the Trash. Nothing else was touched, and you can put it back from the Trash.");
        expect(calls.every((c) => !c.args.includes("rm"))).toBe(true);
    });
    it("a folder: asks first, naming it; moves only on his yes", async () => {
        const { run, calls } = fake((_s, args) => (args[0] === "find" ? { name: "old", matches: [folder] } : { ok: true, from: folder.shown, to: "/h/.Trash/old", id: "y" }));
        const ask = await runKnowledgeMove({ kind: "trash", name: "old", folder: true }, run);
        expect(calls.map((c) => c.args[0])).toEqual(["find"]);
        expect(ask.text).toBe("Move the folder \"old\" (Documents/zz/old, 3 items) to the Trash? Say yes and I'll do it.");
        const pending = new KnowledgePending();
        pending.set("s", ask.held, 0);
        const held = pending.take("s", 1000);
        expect(pending.take("s", 1000)).toBeUndefined();
        expect(readKnowledgeMove("nah leave it", { held: held })).toEqual({ kind: "trash-confirm", held, yes: false });
        const yes = readKnowledgeMove("yes", { held: held });
        const done = await runKnowledgeMove(yes, run);
        expect(calls[1]?.args).toEqual(["move", folder.path, "--confirm", "old"]);
        expect(done.text).toMatch(/^Moved the folder old \(Documents\/zz\) to the Trash\./);
    });
    it("refused or missing: says why and touches nothing", async () => {
        const { run, calls } = fake((_s, args) => (args[0] === "find" ? { name: "proj", matches: [{ ...folder, name: "proj", shown: "Documents/proj", refused: "it holds a git repository" }] } : undefined));
        const out = await runKnowledgeMove({ kind: "trash", name: "proj", folder: true }, run);
        expect(out.text).toBe("I won't move proj to the Trash: it holds a git repository. Nothing was touched.");
        expect(calls).toHaveLength(1);
        const none = await runKnowledgeMove({ kind: "trash", name: "ghost.txt", folder: false }, fake(() => ({ name: "ghost.txt", matches: [] })).run);
        expect(none.text).toBe("I couldn't find ghost.txt in your Desktop, Documents or Downloads, so nothing was touched.");
    });
    // REV6 item 2: a vault note, a loose name match or a name with no place named moved at once; --confirm came from the find.
    it("the vault's note is refused and nothing is moved", async () => {
        const nick = { path: "/h/Documents/orionBrain/20 Areas/Me/Nick.md", shown: "Documents/orionBrain/20 Areas/Me/Nick.md", name: "Nick.md", kind: "file", exact: true, refused: "it is part of your notes vault (orionBrain)" };
        const { run, calls } = fake((_s, args) => (args[0] === "find" ? { name: "Nick.md", matches: [nick] } : { ok: true }));
        const out = await runKnowledgeMove({ kind: "trash", name: "Nick.md", folder: false }, run);
        expect(out.text).toBe("I won't move Nick.md to the Trash: it is part of your notes vault (orionBrain). Nothing was touched.");
        expect(calls.map((c) => c.args[0])).toEqual(["find"]);
    });
    it("a loose match (another spelling) is asked about by its real name; the yes moves it", async () => {
        const todo = { path: "/h/Desktop/To-Do.md", shown: "Desktop/To-Do.md", name: "To-Do.md", kind: "file", exact: false };
        const { run, calls } = fake((_s, args) => (args[0] === "find" ? { name: "todo.md", matches: [todo] } : { ok: true, from: todo.shown, to: "/h/.Trash/To-Do.md", id: "z" }));
        const ask = await runKnowledgeMove({ kind: "trash", name: "todo.md", folder: false, root: "desktop" }, run);
        expect(ask.text).toBe("Move To-Do.md (Desktop/To-Do.md) to the Trash? Say yes and I'll do it.");
        expect(calls.map((c) => c.args[0])).toEqual(["find"]);
        const yes = readKnowledgeMove("yes", { held: ask.held });
        const done = await runKnowledgeMove(yes, run);
        expect(calls[1]?.args).toEqual(["move", todo.path, "--confirm", "To-Do.md"]);
        expect(done.text).toMatch(/^Moved To-Do\.md \(Desktop\) to the Trash\./);
    });
    it("an exact name with no folder or root named is asked about first", async () => {
        const notes = { path: "/h/Documents/a/b/notes.txt", shown: "Documents/a/b/notes.txt", name: "notes.txt", kind: "file", exact: true };
        const { run, calls } = fake((_s, args) => (args[0] === "find" ? { name: "notes.txt", matches: [notes] } : { ok: true }));
        const ask = await runKnowledgeMove({ kind: "trash", name: "notes.txt", folder: false }, run);
        expect(ask.text).toBe("Move notes.txt (Documents/a/b/notes.txt) to the Trash? Say yes and I'll do it.");
        expect(calls).toHaveLength(1);
    });
    it("held out: an exact name inside the folder he named moves at once", async () => {
        const draft = { path: "/h/Downloads/misc/draft-v2.pdf", shown: "Downloads/misc/draft-v2.pdf", name: "draft-v2.pdf", kind: "file", exact: true };
        const { run, calls } = fake((_s, args) => (args[0] === "find" ? { name: "draft-v2.pdf", matches: [draft] } : { ok: true, from: draft.shown, to: "/h/.Trash/draft-v2.pdf", id: "d" }));
        const out = await runKnowledgeMove({ kind: "trash", name: "draft-v2.pdf", folder: false, within: "misc" }, run);
        expect(calls[1]?.args).toEqual(["move", draft.path, "--confirm", "draft-v2.pdf"]);
        expect(out.text).toMatch(/^Moved draft-v2\.pdf \(Downloads\/misc\) to the Trash\./);
    });
    it("a pending confirmation expires", () => {
        const pending = new KnowledgePending();
        pending.set("s", { kind: "trash-confirm", path: "/x", name: "x", shown: "Documents/x" }, 0);
        expect(pending.take("s", 10 * 60_000)).toBeUndefined();
    });
});
