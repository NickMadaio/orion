import { describe, expect, it } from "vitest";
import { runPlaceTurn, type PlaceRun } from "./place-save-run.js";

const aliasStore = new Map<string, string[]>();
const runner = (opts: { setCode?: number; listHas?: boolean; dropAlias?: boolean } = {}) => { const calls: string[][] = []; aliasStore.clear(); const run: PlaceRun = async (a) => { calls.push(a);
  if (a[1] === "set") { const al = a.flatMap((x, i) => (a[i - 1] === "--alias" ? [x] : [])); if (!opts.dropAlias && al.length) aliasStore.set(a[2]!, al); }
  if (a[1] === "alias") { if (opts.setCode) return { stdout: "no such place", code: 1 }; if (!opts.dropAlias) aliasStore.set(a[2]!, [...(aliasStore.get(a[2]!) ?? []), a[4]!]); return { stdout: "added alias", code: 0 }; }
  if (a[1] === "list" && opts.listHas !== false) return { stdout: `home\thome\thome\t150 m\tnick\t\nchapter-spitalfields\tChapter Spitalfields\tother\t120 m\tnick-confirmed\t${(aliasStore.get("chapter-spitalfields") ?? []).join(",")}\n`, code: 0 };
  return a[1] === "set" ? { stdout: opts.setCode ? "no location sample" : "saved chapter-spitalfields", code: opts.setCode ?? 0 } : { stdout: opts.listHas === false ? "home\thome\thome\t150 m\tnick\n" : "home\thome\thome\t150 m\tnick\nchapter-spitalfields\tChapter Spitalfields\tother\t120 m\tnick-confirmed\n", code: 0 }; }; return { calls, run }; };

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

describe("aliases", () => {
  it("a name with an alias saves both and the read-back says both", async () => {
    const r = runner();
    const out = await runPlaceTurn({ kind: "name", name: "Chapter Spitalfields", alias: "spit" }, {}, r.run, 7);
    expect(out.text).toBe('Saved "Chapter Spitalfields" (spit) as a place.');
    expect(r.calls[0]).toEqual(expect.arrayContaining(["--alias", "spit"]));
    expect(out.pending).toEqual({ stage: "saved", name: "Chapter Spitalfields", id: "chapter-spitalfields", at: 7 });
  });
  it("an alias that did not make it into the file is not claimed", async () => {
    const out = await runPlaceTurn({ kind: "name", name: "Chapter Spitalfields", alias: "spit" }, {}, runner({ dropAlias: true }).run, 7);
    expect(out.text).toBe('Saved "Chapter Spitalfields" as a place.');
  });
  it("'call it spit' after the save adds the alias to that place and reads it back", async () => {
    const r = runner();
    await runPlaceTurn({ kind: "name", name: "Chapter Spitalfields" }, {}, r.run, 1);
    const out = await runPlaceTurn({ kind: "alias", alias: "spit" }, { name: "Chapter Spitalfields", id: "chapter-spitalfields" }, r.run, 2);
    expect(out.text).toBe('Okay, "Chapter Spitalfields" is also "spit".');
    expect(r.calls.some((c) => c.join(" ") === "place alias chapter-spitalfields add spit")).toBe(true);
  });
  it("an alias with no place to hang it on, or a refused add, is said", async () => {
    expect((await runPlaceTurn({ kind: "alias", alias: "spit" }, {}, runner().run, 2)).text).toMatch(/couldn't save that place/);
    expect((await runPlaceTurn({ kind: "alias", alias: "spit" }, { name: "X", id: "x" }, runner({ setCode: 1 }).run, 2)).text).toMatch(/couldn't save that place \(no such place\)/);
  });
});
