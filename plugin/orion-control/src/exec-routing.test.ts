import { describe, expect, it } from "vitest";
import { routeForDoomedExec } from "./exec-routing.js";

describe("routeForDoomedExec: the first refusal carries the route", () => {
  it("names orion-recall for a hand-rolled memory grep, and says the pipe was not the point", () => {
    const route = routeForDoomedExec(
      "grep -r 'codename' /Users/nickmadaio/.openclaw/workspace/memory/ | head -20",
    );
    expect(route?.reason).toContain("orion-recall");
    expect(route?.reason).toContain("the command was the wrong idea");
  });

  it("catches the memory search even with NO shell operator, because grep alone still misses", () => {
    const route = routeForDoomedExec(
      "find /Users/nickmadaio/.openclaw/workspace/memory -name '*.md'",
    );
    expect(route?.reason).toContain("orion-recall");
  });

  it("tells a bare wrapper name it is a spelling problem, not a permission one", () => {
    const route = routeForDoomedExec("orion-authority explain");
    expect(route?.reason).toContain("/Users/nickmadaio/Desktop/ORION/scripts/orion-authority");
    expect(route?.reason).toContain("not the same as being forbidden");
  });

  it("does NOT fire for the same wrapper called by absolute path — that one works", () => {
    expect(
      routeForDoomedExec("/Users/nickmadaio/Desktop/ORION/scripts/orion-authority explain"),
    ).toBeUndefined();
  });

  it("sends a catalog action back to orion_task_run", () => {
    expect(routeForDoomedExec("messages_search hello")?.reason).toContain("orion_task_run");
    expect(routeForDoomedExec("screen_observe")?.reason).toContain("orion_task_run");
  });

  it("tells a host tool id it is already a tool", () => {
    expect(routeForDoomedExec("session_status")?.reason).toContain("not a shell command");
  });

  it("routes curl to web_fetch rather than refusing flatly", () => {
    expect(routeForDoomedExec("curl https://example.com")?.reason).toContain("web_fetch");
  });

  it("routes the deliberately-withheld programs to their owners", () => {
    expect(routeForDoomedExec("gog gmail list")?.reason).toContain("orion-gmail");
    expect(routeForDoomedExec("accli list")?.reason).toContain("orion-agenda");
    expect(routeForDoomedExec("sqlite3 chat.db")?.reason).toContain("messages_");
    expect(routeForDoomedExec("vm_stat")?.reason).toContain("system_status");
  });

  it("admits a missing capability instead of inviting another guess", () => {
    expect(routeForDoomedExec("pbpaste")?.reason).toContain("Say so plainly");
  });

  it("explains a shell operator as the operator, not the program", () => {
    const route = routeForDoomedExec("ls /tmp | wc -l");
    expect(route?.reason).toContain("The program may well be allowed; the operator is not");
  });

  it("stays silent on a command that would actually run", () => {
    expect(routeForDoomedExec("ls /Users/nickmadaio/Desktop")).toBeUndefined();
    expect(routeForDoomedExec("git status")).toBeUndefined();
    expect(routeForDoomedExec("")).toBeUndefined();
  });

  it("prefers the memory diagnosis over the generic pipe one, because it is the more useful of two true things", () => {
    const route = routeForDoomedExec("grep -r x ~/.openclaw/workspace/memory/ | head");
    expect(route?.reason).toContain("orion-recall");
    expect(route?.reason).not.toContain("no pipe, redirect");
  });
});
