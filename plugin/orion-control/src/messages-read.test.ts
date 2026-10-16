import { describe, expect, it } from "vitest";
import { parseMessagesRead, readCommand, readNote, runMessagesRead, ORION_GMAIL_SEARCH, ORION_MESSAGES } from "./messages-read.js";

// q066 "read my last 3 texts" and q069 "search gmail for the internship offer" (2026-10-16 r8): both got a
// "I'm reading/searching…" reply with no tool. Code runs the read-only script.
describe("parseMessagesRead", () => {
  it("his exact sentences", () => {
    expect(parseMessagesRead("read my last 3 texts")).toEqual({ kind: "recent", limit: 3 });
    expect(parseMessagesRead("search gmail for the internship offer")).toEqual({ kind: "gmail", query: "internship offer" });
  });
  it("other read phrasings", () => {
    expect(parseMessagesRead("show me my last three messages")).toEqual({ kind: "recent", limit: 3 });
    expect(parseMessagesRead("any new texts")).toEqual({ kind: "recent", limit: 5 });
    expect(parseMessagesRead("did anyone text me")).toEqual({ kind: "recent", limit: 5 });
    expect(parseMessagesRead("read my texts from Carla")).toEqual({ kind: "from", person: "Carla", limit: 5 });
    expect(parseMessagesRead("what did carla text me")).toEqual({ kind: "from", person: "carla", limit: 5 });
    expect(parseMessagesRead("search my texts for dinner")).toEqual({ kind: "search", text: "dinner", limit: 5 });
    expect(parseMessagesRead("search my email for emails from northeastern")).toEqual({ kind: "gmail", query: "from:northeastern" });
  });
  it("sends and unrelated turns are not reads", () => {
    for (const m of ["text mom i'm late", "email myself my tasks", "send me a text", "add a todo to email prof", "remind me to read my texts", "what's the weather", "text myself bring the charger"]) expect(parseMessagesRead(m), m).toBeNull();
  });
});

describe("runMessagesRead", () => {
  const stub = (stdout: string, code = 0) => { const calls: Array<[string, string[]]> = []; return { calls, exec: async (f: string, a: string[]) => { calls.push([f, a]); return { stdout, code }; } }; };
  it("runs the read-only texts script with argv only", async () => {
    const s = stub("2026-10-16 14:02  Gia: running late\n2026-10-16 13:10  Mom: call me");
    const out = await runMessagesRead({ kind: "recent", limit: 3 }, s.exec);
    expect(s.calls).toEqual([[ORION_MESSAGES, ["recent", "3"]]]);
    expect(out.data).toContain("Gia: running late");
    expect(out.calls).toEqual(["exec orion-messages recent 3"]);
    expect(readNote({ kind: "recent", limit: 3 }, out.data!)).toMatch(/Do not call any tools/);
  });
  it("runs the gmail search with the query as one argument", async () => {
    const s = stub("Internship offer — Acme <hr@acme.com> Oct 14");
    const out = await runMessagesRead({ kind: "gmail", query: "internship offer" }, s.exec);
    expect(s.calls).toEqual([[ORION_GMAIL_SEARCH, ["internship offer"]]]);
    expect(out.calls).toEqual(['exec orion-gmail-search "internship offer"']);
    expect(out.data).toMatch(/Acme/);
  });
  it("says a failure exactly, and an empty result plainly", async () => {
    const fda = await runMessagesRead({ kind: "recent", limit: 3 }, stub("orion-messages: Full Disk Access is required to read Messages, and the process running this does not have it.", 1).exec);
    expect(fda.say).toBe("I couldn't read your texts: Full Disk Access is required to read Messages, and the process running this does not have it. Nothing was sent or changed.");
    const none = await runMessagesRead({ kind: "gmail", query: "internship offer" }, stub('No mail matched "internship offer".').exec);
    expect(none.say).toBe('Nothing in your Gmail matched "internship offer".');
  });
  it("readCommand names the script", () => {
    expect(readCommand({ kind: "from", person: "Carla", limit: 5 }).args).toEqual(["from", "Carla", "5"]);
  });
});
