// A preposition between the title and the time is part of how he said it, never of the title ("schedule reading for 10 to 11pm").
import { describe, expect, it } from "vitest";
import { readNamedWrite } from "./calendar-resolve.js";

describe("named write titles", () => {
  const cases: Array<[string, string]> = [
    ["schedule reading for 10 to 11pm", "reading"],
    ["put reading at 10 to 11pm", "reading"],
    ["book piano practice around 7 to 8pm", "piano practice"],
    ["add laundry on 9 to 10pm", "laundry"],
    ["pencil in call with mum starting at 8 to 8:30pm", "call with mum"],
    ["add a walk for 6-7pm", "walk"],
    ["put guitar from 9 to 10pm", "guitar"],
  ];
  for (const [say, name] of cases) {
    it(`${say} names ${name}`, () => {
      const r = readNamedWrite(say);
      expect(r?.name).toBe(name);
      expect(r?.from).toBeTruthy();
      expect(r?.until).toBeTruthy();
    });
  }
});
