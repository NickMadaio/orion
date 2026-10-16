import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FRONT_DESK_SYSTEM } from "./front-desk-prompt.js";
import { GENERAL_INSTRUCTIONS, SCHEDULING_INSTRUCTIONS } from "./job-instructions.js";

// Live sweep 2026-10-15 (q040-q047): the worker prompts advertised `orion-tasks done` and
// `orion-agenda … --todos`, which did not exist; the front desk's tasks tool had no "list", so
// "whats on my list rn" read the calendar; and "due friday" after adding a to-do ran a second add.
const script = (name: string) => readFileSync(new URL(`../../../scripts/${name}`, import.meta.url), "utf8");
const advertised = (prompt: string, cmd: string) =>
  [...prompt.matchAll(new RegExp(`${cmd} ([a-z][a-z-]*)((?: ?\\| [a-z][a-z-]*\\b[^|\\n]*)*)`, "g"))]
    .flatMap((m) => [m[1], ...[...(m[2] ?? "").matchAll(/\| ([a-z][a-z-]*)/g)].map((x) => x[1])]);

describe("to-do commands the prompts advertise", () => {
  it("every orion-tasks subcommand in the worker prompts exists in the script", () => {
    const supported = [...script("orion-tasks").matchAll(/command === "([a-z]+)"/g)].map((m) => m[1]);
    for (const prompt of [GENERAL_INSTRUCTIONS, SCHEDULING_INSTRUCTIONS]) {
      const used = advertised(prompt, "orion-tasks");
      expect(used.length).toBeGreaterThan(0);
      for (const sub of used) expect(supported, `orion-tasks ${sub}`).toContain(sub);
    }
    expect(advertised(GENERAL_INSTRUCTIONS, "orion-tasks")).toEqual(expect.arrayContaining(["list", "add", "set", "done"]));
    expect(advertised(SCHEDULING_INSTRUCTIONS, "orion-tasks")).toContain("done");
  });

  it("orion-agenda is never advertised with a --todos flag it does not have", () => {
    expect(script("orion-agenda")).not.toMatch(/--todos/);
    expect(GENERAL_INSTRUCTIONS).not.toMatch(/orion-agenda[^\n]*--todos/);
  });

  it("a due date, priority or new name for a to-do just added is a set, never a second add", () => {
    for (const prompt of [GENERAL_INSTRUCTIONS, SCHEDULING_INSTRUCTIONS]) {
      expect(prompt).toMatch(/to-do (he|you) just added[^\n]*orion-tasks set[^\n]*never a second (`orion-tasks )?add/i);
    }
  });

  it("the front desk can list his to-dos, and his list is a tasks read, not the calendar", () => {
    expect(FRONT_DESK_SYSTEM).toMatch(/- tasks: [^\n]*"do":"list\|add\|set\|done"/);
    expect(FRONT_DESK_SYSTEM).toMatch(/whats on my list[^\n]*tool tasks with do "list"/i);
  });
});
