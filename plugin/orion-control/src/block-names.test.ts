import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blocksNamedBy, coursesInText, intentOf, loadCourseAliases, namesTitle, resolveBlockName, useCourseAliases, whichOne } from "./block-names.js";

const cases = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "tests", "fixtures", "block-names-cases.json"), "utf8")) as {
  aliases: Record<string, string[]>; match: Array<[string, string, boolean]> };
const aliases = new Map(Object.entries(cases.aliases));
afterEach(() => useCourseAliases(undefined));

describe("block names: one resolver for his everyday names", () => {
  for (const [name, title, want] of cases.match) {
    it(`"${name}" ${want ? "names" : "does not name"} ${title}`, () => expect(namesTitle(name, title, aliases)).toBe(want));
  }

  it("reads course names from free text, a brain note dir and life-config, as data", () => {
    const dir = mkdtempSync(join(tmpdir(), "bn-"));
    const courses = join(dir, "Courses"); mkdirSync(courses);
    writeFileSync(join(dir, "USER.md"), "Weekly classes (PHIL2001, GEOG1200\nRivers, ARTS3000 is Studio Practice 2).");
    writeFileSync(join(courses, "PSYC1100.md"), "---\ntitle: PSYC1100\n---\n- [name] PSYC1100 Principles of Cognition 2026/27\n");
    writeFileSync(join(courses, "PSYC1100 Quiz 1.md"), "- [name] ignored");
    writeFileSync(join(dir, "life-config.json"), JSON.stringify({ courses: { MUSC1001: "Introduction to Harmony" } }));
    const got = loadCourseAliases({ userMd: join(dir, "USER.md"), coursesDir: courses, lifeConfig: join(dir, "life-config.json") });
    expect(got.get("geog1200")).toEqual(["rivers"]);
    expect(got.get("arts3000")).toEqual(["studio", "practice"]);
    expect(got.get("psyc1100")).toEqual(["cognition"]);
    expect(got.get("musc1001")).toEqual(["harmony"]);
    expect(got.has("phil2001")).toBe(false);
    expect(loadCourseAliases({ userMd: join(dir, "missing.md") }).size).toBe(0);
  });

  it("parses the code-then-subject shape across a line break", () => {
    expect([...coursesInText("ECON1115\nMacro, MKTG2201 Marketing)").keys()]).toEqual(["econ1115", "mktg2201"]);
  });

  const day = [
    { title: "ECON1115", start: "11:00", end: "12:30", kind: "class", fixed: true },
    { title: "Econ problem set", start: "15:00", end: "16:00", kind: "study", fixed: false },
    { title: "Side project", start: "19:30", end: "20:30", fixed: false },
  ];
  it("one name for a class and a study block: the verb decides, else ask naming both", () => {
    useCourseAliases(aliases);
    expect(resolveBlockName("econ", day, { now: 600, intent: intentOf("i'm gonna skip econ") })).toEqual({ block: day[0] });
    expect(resolveBlockName("econ", day, { now: 600, intent: intentOf("let me work on econ for a bit") })).toEqual({ block: day[1] });
    const r = resolveBlockName("econ", day, { now: 600 });
    expect(r && "ambiguous" in r).toBe(true);
    expect(whichOne((r as { ambiguous: typeof day }).ambiguous)).toBe("Do you mean ECON1115 at 11:00 AM or Econ problem set at 3:00 PM? I haven't changed anything.");
    expect(blocksNamedBy("econ class", day)).toEqual([day[0]]);
  });

  it("held-out phrasings in his style", () => {
    useCourseAliases(aliases);
    const blocks = [...day, { title: "MKTG2201", start: "13:30", end: "15:30", kind: "class", fixed: true }];
    expect(blocksNamedBy("ur mktg lecture", blocks).map((b) => b.title)).toEqual(["MKTG2201"]);
    expect(blocksNamedBy("macroeconomics", blocks).map((b) => b.title)).toEqual(["ECON1115"]);
    expect(blocksNamedBy("sideproject", blocks).map((b) => b.title)).toEqual(["Side project"]);
    expect(blocksNamedBy("side proj tonite", blocks).map((b) => b.title)).toEqual(["Side project"]);
  });
});
