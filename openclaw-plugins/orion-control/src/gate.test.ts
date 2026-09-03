import { mkdtemp, readdir, writeFile, mkdir } from "node:fs/promises";
import os, { hostname } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  applyUserTurnDecisions,
  approvalPaths,
  consumeGrant,
  decisionsInUserTurn,
  grant,
  grantedHashes,
  mintTicket,
  normalizeTicketId,
  readTickets,
  TICKET_RE,
  TICKET_TTL_MS,
} from "./approvals.js";
import {
  DEFAULT_MODE,
  MAX_DELEGATION_MS,
  STRICTNESS_MODES,
  applyMode,
  floorForAction,
  isRelaxation,
  levelForAction,
  resolveStrictness,
  writeStrictness,
  GUARDED_STATE,
} from "./strictness.js";
import { ACTION_CATALOG } from "./catalog.js";

const tmp = () => mkdtemp(path.join(os.tmpdir(), "orion-gate-"));

describe("the approval gate has a person in it", () => {
  it("mints an id a person could read out, and refuses anything else", async () => {
    const paths = approvalPaths(await tmp());
    const ticket = await mintTicket(paths, {
      canonicalHash: "a".repeat(64),
      action: "messages_send",
      summary: "messages_send — recipient: Mum",
      context: "text Mum",
    });
    expect(ticket.id).toMatch(TICKET_RE);
    // No 0/O/1/I/L anywhere. This is the difference between an id Nick reads
    // back correctly the first time and one he gets wrong at 2am.
    expect(ticket.id).not.toMatch(/[01OIL]/);

    // Every spelling a person actually types resolves to the same ticket.
    for (const spelling of [ticket.id, ticket.id.toLowerCase(), ticket.id.slice(2)]) {
      expect(normalizeTicketId(spelling)).toBe(ticket.id);
    }
    for (const nonsense of ["", "A-", "hello", "A-0000", "A-TOOLONG"]) {
      expect(normalizeTicketId(nonsense)).toBeNull();
    }
  });

  it("does not open for a hash alone, only for a grant", async () => {
    const paths = approvalPaths(await tmp());
    const hash = "b".repeat(64);
    const ticket = await mintTicket(paths, {
      canonicalHash: hash,
      action: "messages_send",
      summary: "s",
      context: "c",
    });
    // Knowing the hash is worth nothing. This is the whole defect, as a test.
    expect(grantedHashes(paths).has(hash)).toBe(false);

    expect((await grant(paths, ticket.id, "nick@discord")).ok).toBe(true);
    expect(grantedHashes(paths).has(hash)).toBe(true);
  });

  it("refuses an approval that claims to come from the local process", async () => {
    const paths = approvalPaths(await tmp());
    const ticket = await mintTicket(paths, {
      canonicalHash: "c".repeat(64),
      action: "messages_send",
      summary: "s",
      context: "c",
    });
    /*
     `local` is what an exec call from Orion himself presents to orion-remote:
     `--from` is absent, the sender defaults to "local", and "local" is in the
     default allowlist. Before this refusal existed, `orion-remote handle --
     approve ap-1a2b3c4d` was a call Orion could make.
    */
    for (const forger of ["local", "LOCAL", "orion", ""]) {
      const attempt = await grant(paths, ticket.id, forger);
      expect(attempt.ok).toBe(false);
    }
    expect(grantedHashes(paths).size).toBe(0);
  });

  it("binds the ticket to this Mac", async () => {
    const paths = approvalPaths(await tmp());
    const ticket = await mintTicket(paths, {
      canonicalHash: "1".repeat(64),
      action: "messages_send",
      summary: "s",
      context: "c",
    });
    expect(ticket.deviceId).toBe(hostname());
    // Phase 49 wants target device on the approval, and the approval directory
    // is syncable: an approval that followed a file to another machine would
    // be an approval for something nobody there asked for.
    await writeFile(
      path.join(paths.tickets, `${ticket.id}.json`),
      JSON.stringify({ ...ticket, deviceId: "some-other-mac" }),
    );
    expect(readTickets(paths)).toHaveLength(0);
  });

  it("will not grant an id nothing minted", async () => {
    const paths = approvalPaths(await tmp());
    const invented = await grant(paths, "A-7F3K", "nick@discord");
    expect(invented.ok).toBe(false);
    expect(grantedHashes(paths).size).toBe(0);
  });

  it("spends a grant exactly once", async () => {
    const paths = approvalPaths(await tmp());
    const hash = "d".repeat(64);
    const ticket = await mintTicket(paths, {
      canonicalHash: hash,
      action: "file_delete",
      summary: "s",
      context: "c",
    });
    await grant(paths, ticket.id, "nick@terminal");
    expect(await consumeGrant(paths, hash)).toBe(true);
    // Phase 45's rule, one layer up: a resent proof is indistinguishable from a
    // captured one, so the gate must never be asked to guess which it holds.
    expect(await consumeGrant(paths, hash)).toBe(false);
    expect(grantedHashes(paths).has(hash)).toBe(false);
    expect((await readdir(paths.used)).length).toBe(2);
  });

  it("ignores a grant whose nonce was not the one minted", async () => {
    const paths = approvalPaths(await tmp());
    const hash = "e".repeat(64);
    const ticket = await mintTicket(paths, {
      canonicalHash: hash,
      action: "messages_send",
      summary: "s",
      context: "c",
    });
    await mkdir(paths.grants, { recursive: true });
    // A forged grant: right id, right hash, wrong nonce. The nonce is 128 bits
    // from the CSPRNG and appears nowhere but the ticket file, so this is what
    // an attacker who can write the directory but has not read it produces.
    await writeFile(
      path.join(paths.grants, `${ticket.id}.json`),
      JSON.stringify({
        id: ticket.id,
        canonicalHash: hash,
        nonce: "0".repeat(32),
        grantedAt: new Date().toISOString(),
        grantedBy: "nick@discord",
      }),
    );
    expect(grantedHashes(paths).has(hash)).toBe(false);
  });

  it("lets an approval go stale rather than waiting forever", async () => {
    const paths = approvalPaths(await tmp());
    const minted = new Date("2026-09-02T10:00:00Z");
    const hash = "f".repeat(64);
    const ticket = await mintTicket(
      paths,
      { canonicalHash: hash, action: "messages_send", summary: "s", context: "c" },
      minted,
    );
    await grant(paths, ticket.id, "nick@discord", minted);
    const justInside = new Date(minted.getTime() + TICKET_TTL_MS - 1000);
    const justOutside = new Date(minted.getTime() + TICKET_TTL_MS + 1000);
    expect(grantedHashes(paths, justInside).has(hash)).toBe(true);
    expect(grantedHashes(paths, justOutside).has(hash)).toBe(false);
    expect(readTickets(paths, justOutside)).toHaveLength(0);
  });

  it("returns the waiting ticket rather than minting a second id for the same thing", async () => {
    const paths = approvalPaths(await tmp());
    const request = {
      canonicalHash: "9".repeat(64),
      action: "messages_send",
      summary: "s",
      context: "c",
    };
    const first = await mintTicket(paths, request);
    const second = await mintTicket(paths, request);
    // Two ids for one question is how a person stops reading the ids.
    expect(second.id).toBe(first.id);
    expect(readTickets(paths)).toHaveLength(1);
  });
});

describe("saying yes out loud", () => {
  const ticketAt = (id: string): never | { id: string } => ({ id });
  const fake = (id: string) =>
    ({
      id,
      canonicalHash: "a".repeat(64),
      nonce: "n",
      action: "messages_send",
      summary: "s",
      context: "c",
      mintedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      deviceId: hostname(),
    }) as Parameters<typeof decisionsInUserTurn>[1][number];

  const decide = (text: string) => decisionsInUserTurn(text, [fake("A-7F3K")]);

  it("hears an approval however the transcriber spelled it", () => {
    // Deepgram, the local model and a keyboard all render this differently,
    // and Nick drops the `A-` about half the time.
    for (const spelling of [
      "approve A-7F3K",
      "approve a7f3k",
      "yes, approve a 7 f 3 k",
      "Approve A. 7 F 3 K",
      "go ahead with A-7F3K",
      "confirm a-7f3k please",
    ]) {
      expect(decide(spelling), spelling).toEqual([{ id: "A-7F3K", decision: "approved" }]);
    }
  });

  it("does not hear an approval in a question or a refusal", () => {
    /*
     The failure that would matter most: a message sent because Nick said the
     id out loud while working out whether he wanted to. Ambiguity returns
     nothing at all rather than a guess -- the model then has to ask, which
     costs a turn, where guessing costs something that cannot be unsent.
    */
    for (const text of [
      "what does A-7F3K do?",
      "A-7F3K",
      "don't approve A-7F3K",
      "do not approve A-7F3K yet",
      "hold off on A-7F3K",
      "I'm not going to approve A-7F3K",
      "read me A-7F3K again",
    ]) {
      expect(decide(text), text).toEqual([]);
    }
  });

  it("hears a refusal as a refusal", () => {
    for (const text of ["deny A-7F3K", "reject a7f3k", "no to A-7F3K"]) {
      expect(decide(text), text).toEqual([{ id: "A-7F3K", decision: "denied" }]);
    }
  });

  it("reads only the clause the id is in", () => {
    // Two instructions in one breath. A negation belonging to the first half
    // must not read as a refusal of the second, and an `approve` from the
    // first half must not carry an id Nick only mentioned in passing.
    expect(decide("don't cancel the alarm, and approve A-7F3K")).toEqual([
      { id: "A-7F3K", decision: "approved" },
    ]);
    expect(decide("approve the plan. what is A-7F3K")).toEqual([]);
  });

  it("says nothing about a ticket that does not exist", () => {
    expect(decisionsInUserTurn("approve A-7F3K", [])).toEqual([]);
  });

  it("writes a real grant from a real turn", async () => {
    const paths = approvalPaths(await tmp());
    const ticket = await mintTicket(paths, {
      canonicalHash: "7".repeat(64),
      action: "messages_send",
      summary: "s",
      context: "c",
    });
    expect(grantedHashes(paths).size).toBe(0);
    const acted = await applyUserTurnDecisions(paths, `yes, approve ${ticket.id}`);
    expect(acted).toEqual([{ id: ticket.id, decision: "approved" }]);
    expect(grantedHashes(paths).has("7".repeat(64))).toBe(true);
  });
});

describe("strictness: how much friction, as its own axis", () => {
  it("changes nothing at all under the default mode", () => {
    /*
     The load-bearing compatibility claim, in two halves.

     Every closed phase's evidence was recorded against the ladder as it was,
     so `guarded` has to still BE it. That holds only if two things are true,
     and asserting one without the other would be asserting nothing.
    */
    // 1. The mode itself is the identity, at every rung.
    const noFloor = { level: "AUTO" as const, reason: null, because: "" };
    for (const base of ["AUTO", "NOTIFY", "APPROVAL", "NEVER"] as const) {
      expect(applyMode(base, noFloor, "guarded").level).toBe(base);
    }
    // 2. No floor invents friction the catalog did not already demand. If a
    //    floor could sit ABOVE what the existing gate produces, `guarded`
    //    would silently start refusing things that ran yesterday.
    for (const [name, definition] of Object.entries(ACTION_CATALOG)) {
      const floor = floorForAction(name, definition);
      if (floor.level === "APPROVAL") {
        expect(
          definition.approvalRequired,
          `${name} floors at APPROVAL but the catalog does not require approval for it`,
        ).toBe(true);
      }
      if (floor.level === "NOTIFY") {
        expect(
          definition.reversible === false || definition.risk === "high" || definition.risk === "critical",
          `${name} floors at NOTIFY but nothing in its metadata says why`,
        ).toBe(true);
      }
    }
  });

  it("never lets a mode reach something the profile did not grant", () => {
    // NEVER is availability, not friction. `sovereign` relaxes the ladder; it
    // does not switch a disabled tier on, and nothing here should ever let it.
    for (const mode of STRICTNESS_MODES) {
      for (const [name, definition] of Object.entries(ACTION_CATALOG)) {
        expect(levelForAction(name, definition, "NEVER", mode).level).toBe("NEVER");
      }
    }
  });

  it("holds the three things no delegation may cover", () => {
    const held = Object.entries(ACTION_CATALOG)
      .map(([name, definition]) => ({
        name,
        floor: floorForAction(name, definition),
        sovereign: levelForAction(name, definition, "AUTO", "sovereign").level,
      }))
      .filter((row) => row.floor.reason !== null);

    // Changing what Orion may do is the one that makes the ladder mean
    // anything: if `sovereign` made this free, Orion could put himself in
    // `sovereign` and the mode would be a note he writes to himself.
    const authority = held.filter((row) => row.floor.reason === "authority_change");
    expect(authority.map((row) => row.name).sort()).toEqual([
      "self_config_authority_set",
      "self_plugin_authority_modify",
      "self_script_authority_modify",
    ]);
    for (const row of authority) expect(row.sovereign).toBe("APPROVAL");

    // Reaching somebody else stays approved even at the most permissive mode.
    expect(
      held.find((row) => row.name === "messages_send")?.sovereign,
    ).toBe("APPROVAL");

    // Everything he cannot undo is at least announced.
    for (const row of held.filter((r) => r.floor.reason === "irreversible")) {
      expect(row.sovereign).not.toBe("AUTO");
    }
  });

  it("makes sovereign free for everything the floor does not hold", () => {
    const free = Object.entries(ACTION_CATALOG).filter(
      ([name, definition]) =>
        floorForAction(name, definition).reason === null &&
        levelForAction(name, definition, "APPROVAL", "sovereign").level === "AUTO",
    );
    /*
     The point of the mode. If this ever became empty, `sovereign` would be an
     expensive way to spell `guarded`.

     Pinned as "everything except the floored ones" rather than as a number:
     a bare count passes just as happily when half the catalog has quietly
     acquired a floor, which is the failure this is watching for.
    */
    const floored = Object.entries(ACTION_CATALOG).filter(
      ([name, definition]) => floorForAction(name, definition).reason !== null,
    );
    expect(free.length).toBe(Object.keys(ACTION_CATALOG).length - floored.length);
    expect(floored.length).toBeLessThan(Object.keys(ACTION_CATALOG).length / 4);
  });

  it("keeps reads free under contained and asks about everything else", () => {
    const contained = (name: string) =>
      levelForAction(name, ACTION_CATALOG[name]!, "AUTO", "contained").level;
    // A mode nobody can bear to switch on protects nothing.
    expect(contained("desktop_list")).toBe("AUTO");
    expect(contained("file_delete")).toBe("APPROVAL");
  });

  it("orders the modes so that less friction is the direction needing a person", () => {
    expect(isRelaxation("guarded", "sovereign")).toBe(true);
    expect(isRelaxation("guarded", "contained")).toBe(false);
    expect(isRelaxation("sovereign", "sovereign")).toBe(false);
    // Orion may always tighten. That is the one move he can make alone.
    expect(isRelaxation("sovereign", "contained")).toBe(false);
  });

  it("falls back to guarded for every reason a file can be wrong", async () => {
    const directory = await tmp();
    const missing = path.join(directory, "nothing.json");
    expect(resolveStrictness(missing).mode).toBe(DEFAULT_MODE);

    const corrupt = path.join(directory, "corrupt.json");
    await writeFile(corrupt, "{not json");
    expect(resolveStrictness(corrupt).mode).toBe(DEFAULT_MODE);
    expect(resolveStrictness(corrupt).degraded).toBeDefined();

    const unknown = path.join(directory, "unknown.json");
    await writeFile(unknown, JSON.stringify({ mode: "unlimited" }));
    expect(resolveStrictness(unknown).mode).toBe(DEFAULT_MODE);
    expect(resolveStrictness(unknown).degraded).toBeDefined();
  });

  it("ends a delegation at its expiry without anything having to fire", async () => {
    const file = path.join(await tmp(), "strictness.json");
    const setAt = new Date("2026-09-02T20:00:00Z");
    await writeStrictness(file, {
      ...GUARDED_STATE,
      mode: "sovereign",
      setBy: "nick@terminal",
      reason: "going out",
      expiresAt: new Date(setAt.getTime() + 3 * 60 * 60 * 1000).toISOString(),
    });
    expect(resolveStrictness(file, new Date("2026-09-02T22:00:00Z")).mode).toBe("sovereign");
    // Computed at read time. A delegation that ends only when a timer fires is
    // a delegation that outlives a reboot.
    const after = resolveStrictness(file, new Date("2026-09-03T04:00:00Z"));
    expect(after.mode).toBe("guarded");
    expect(after.expired).toBe(true);
  });

  it("reads an unparseable expiry as expired rather than as forever", async () => {
    const file = path.join(await tmp(), "strictness.json");
    await writeStrictness(file, {
      ...GUARDED_STATE,
      mode: "sovereign",
      expiresAt: "banana",
    });
    expect(resolveStrictness(file).mode).toBe("guarded");
  });

  it("bounds how long a delegation may run", () => {
    expect(MAX_DELEGATION_MS).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it("honours an exception by name or by tier, and only upward", () => {
    /*
     Phase 50's own example: "Allow calendar create/update. Never delete."

     Both spellings work because both are things a person says -- one action by
     name, or a whole tier at once. What is NOT expressible is the inverse: an
     exception cannot lower a level, because it is combined with `worst`. That
     is deliberate. An exception that could carve a hole in the floor would be
     a floor with extra steps.
    */
    const byName = levelForAction(
      "calendar_event_remove",
      ACTION_CATALOG.calendar_event_remove!,
      "AUTO",
      "sovereign",
      { calendar_event_remove: "APPROVAL" },
    );
    expect(byName.level).toBe("APPROVAL");

    const byTier = levelForAction(
      "apple_reminder_add",
      ACTION_CATALOG.apple_reminder_add!,
      "AUTO",
      "sovereign",
      { calendar: "APPROVAL" },
    );
    expect(byTier.level).toBe("APPROVAL");

    // Downward is not a thing an exception can do.
    const attempted = levelForAction(
      "messages_send",
      ACTION_CATALOG.messages_send!,
      "APPROVAL",
      "sovereign",
      { messages_send: "AUTO" },
    );
    expect(attempted.level).toBe("APPROVAL");
  });

  it("ignores a delegation addressed to a different Mac", async () => {
    const file = path.join(await tmp(), "strictness.json");
    await writeStrictness(file, {
      ...GUARDED_STATE,
      mode: "sovereign",
      deviceId: "somebody-elses-macbook",
    });
    const resolved = resolveStrictness(file);
    expect(resolved.mode).toBe("guarded");
    expect(resolved.degraded).toMatch(/not to this Mac/);
  });

  it("lets an exception add friction and never remove it", () => {
    // Phase 50's example -- "allow calendar create/update, never delete" -- is
    // expressible. Its inverse, a hole punched through the floor, is not: the
    // floor is applied after everything else and only ever raises.
    const raised = applyMode("AUTO", floorForAction("messages_send", ACTION_CATALOG.messages_send!), "sovereign");
    expect(raised.level).toBe("APPROVAL");
    expect(raised.heldByFloor).toBe(true);
  });
});
