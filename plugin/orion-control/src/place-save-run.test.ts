import { describe, expect, it } from "vitest";
import { runPlaceTurn, type PlaceRun } from "./place-save-run.js";

const runner = (opts: { setCode?: number; listHas?: boolean } = {}) => { const calls: string[][] = []; const run: PlaceRun = async (a) => { calls.push(a); return a[1] === "set" ? { stdout: opts.setCode ? "no location sample" : "saved chapter-spitalfields", code: opts.setCode ?? 0 } : { stdout: opts.listHas === false ? "home\thome\thome\t150 m\tnick\n" : "home\thome\thome\t150 m\tnick\nchapter-spitalfields\tChapter Spitalfields\tother\t120 m\tnick-confirmed\n", code: 0 }; }; return { calls, run }; };

describe("saving a place", () => {
  it("a name saves and reads back", async () => {
    const r = runner();
    const out = await runPlaceTurn({ kind: "name", name: "Chapter Spitalfields" }, {}, r.run, 1);
    expect(out.text).toBe('Saved "Chapter Spitalfields" as a place.');
    expect(r.calls[0]).toEqual(["place", "set", "chapter-spitalfields", "--here", "--name", "Chapter Spitalfields", "--kind", "other", "--source", "nick-confirmed"]);
    expect(r.calls[1]).toEqual(["place", "list"]);
  });
  it("a yes with a known name saves it; with none it asks and keeps the thread", async () => {
    const r = runner();
    expect((await runPlaceTurn({ kind: "yes" }, { name: "Chapter Spitalfields" }, r.run, 1)).text).toBe('Saved "Chapter Spitalfields" as a place.');
    const asked = await runPlaceTurn({ kind: "yes" }, {}, runner().run, 5);
    expect(asked.text).toMatch(/call it\?$/);
    expect(asked.pending).toEqual({ stage: "name", at: 5 });
  });
  it("no leaves it and writes nothing", async () => {
    const r = runner();
    expect((await runPlaceTurn({ kind: "no" }, {}, r.run, 1)).text).toBe("Okay, I won't save it.");
    expect(r.calls).toEqual([]);
  });
  it("a failed write or a missing read-back is said, never 'Saved'", async () => {
    expect((await runPlaceTurn({ kind: "name", name: "X Y" }, {}, runner({ setCode: 1 }).run, 1)).text).toMatch(/couldn't save that place \(no location sample\), so nothing was saved/);
    expect((await runPlaceTurn({ kind: "name", name: "Chapter Spitalfields" }, {}, runner({ listHas: false }).run, 1)).text).toMatch(/couldn't save that place/);
  });
});
