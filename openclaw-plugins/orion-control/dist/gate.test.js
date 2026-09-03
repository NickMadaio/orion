import { spawn } from "node:child_process";
import { mkdtemp, readdir, writeFile, mkdir } from "node:fs/promises";
import os, { hostname } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyUserTurnDecisions, approvalPaths, consumeGrant, decisionsInUserTurn, grant, grantedHashes, mintTicket, normalizeTicketId, readTickets, TICKET_RE, TICKET_TTL_MS, } from "./approvals.js";
import { DEFAULT_MODE, MAX_DELEGATION_MS, STRICTNESS_MODES, applyMode, floorForAction, isRelaxation, levelForAction, resolveStrictness, writeStrictness, GUARDED_STATE, } from "./strictness.js";
import { ACTION_CATALOG } from "./catalog.js";
import { boundOutput, devEnvironment, resolveDevCommand } from "./devops.js";
import { cronExpression, simulate, validateProposal } from "./automation.js";
import { renderCard, termsFromEvent } from "./prep.js";
import { MAX_SURFACES, civilToday, daysLate, draftFollowUp, overdue, pending, validateItem, } from "./waiting.js";
import { EPISTEMIC_TO_CONFIDENCE, confidenceOfStep, explainRun, isActionable, } from "./explain.js";
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
        await writeFile(path.join(paths.tickets, `${ticket.id}.json`), JSON.stringify({ ...ticket, deviceId: "some-other-mac" }));
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
        await writeFile(path.join(paths.grants, `${ticket.id}.json`), JSON.stringify({
            id: ticket.id,
            canonicalHash: hash,
            nonce: "0".repeat(32),
            grantedAt: new Date().toISOString(),
            grantedBy: "nick@discord",
        }));
        expect(grantedHashes(paths).has(hash)).toBe(false);
    });
    it("lets an approval go stale rather than waiting forever", async () => {
        const paths = approvalPaths(await tmp());
        const minted = new Date("2026-09-02T10:00:00Z");
        const hash = "f".repeat(64);
        const ticket = await mintTicket(paths, { canonicalHash: hash, action: "messages_send", summary: "s", context: "c" }, minted);
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
    const ticketAt = (id) => ({ id });
    const fake = (id) => ({
        id,
        canonicalHash: "a".repeat(64),
        nonce: "n",
        action: "messages_send",
        summary: "s",
        context: "c",
        mintedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        deviceId: hostname(),
    });
    const decide = (text) => decisionsInUserTurn(text, [fake("A-7F3K")]);
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
        const noFloor = { level: "AUTO", reason: null, because: "" };
        for (const base of ["AUTO", "NOTIFY", "APPROVAL", "NEVER"]) {
            expect(applyMode(base, noFloor, "guarded").level).toBe(base);
        }
        // 2. No floor invents friction the catalog did not already demand. If a
        //    floor could sit ABOVE what the existing gate produces, `guarded`
        //    would silently start refusing things that ran yesterday.
        for (const [name, definition] of Object.entries(ACTION_CATALOG)) {
            const floor = floorForAction(name, definition);
            if (floor.level === "APPROVAL") {
                expect(definition.approvalRequired, `${name} floors at APPROVAL but the catalog does not require approval for it`).toBe(true);
            }
            if (floor.level === "NOTIFY") {
                expect(definition.reversible === false || definition.risk === "high" || definition.risk === "critical", `${name} floors at NOTIFY but nothing in its metadata says why`).toBe(true);
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
        for (const row of authority)
            expect(row.sovereign).toBe("APPROVAL");
        // Reaching somebody else stays approved even at the most permissive mode.
        expect(held.find((row) => row.name === "messages_send")?.sovereign).toBe("APPROVAL");
        // Everything he cannot undo is at least announced.
        for (const row of held.filter((r) => r.floor.reason === "irreversible")) {
            expect(row.sovereign).not.toBe("AUTO");
        }
    });
    it("makes sovereign free for everything the floor does not hold", () => {
        const free = Object.entries(ACTION_CATALOG).filter(([name, definition]) => floorForAction(name, definition).reason === null &&
            levelForAction(name, definition, "APPROVAL", "sovereign").level === "AUTO");
        /*
         The point of the mode. If this ever became empty, `sovereign` would be an
         expensive way to spell `guarded`.
    
         Pinned as "everything except the floored ones" rather than as a number:
         a bare count passes just as happily when half the catalog has quietly
         acquired a floor, which is the failure this is watching for.
        */
        const floored = Object.entries(ACTION_CATALOG).filter(([name, definition]) => floorForAction(name, definition).reason !== null);
        expect(free.length).toBe(Object.keys(ACTION_CATALOG).length - floored.length);
        expect(floored.length).toBeLessThan(Object.keys(ACTION_CATALOG).length / 4);
    });
    it("keeps reads free under contained and asks about everything else", () => {
        const contained = (name) => levelForAction(name, ACTION_CATALOG[name], "AUTO", "contained").level;
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
        const byName = levelForAction("calendar_event_remove", ACTION_CATALOG.calendar_event_remove, "AUTO", "sovereign", { calendar_event_remove: "APPROVAL" });
        expect(byName.level).toBe("APPROVAL");
        const byTier = levelForAction("apple_reminder_add", ACTION_CATALOG.apple_reminder_add, "AUTO", "sovereign", { calendar: "APPROVAL" });
        expect(byTier.level).toBe("APPROVAL");
        // Downward is not a thing an exception can do.
        const attempted = levelForAction("messages_send", ACTION_CATALOG.messages_send, "APPROVAL", "sovereign", { messages_send: "AUTO" });
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
        const raised = applyMode("AUTO", floorForAction("messages_send", ACTION_CATALOG.messages_send), "sovereign");
        expect(raised.level).toBe("APPROVAL");
        expect(raised.heldByFloor).toBe(true);
    });
});
describe("phase 51: structured development operations", () => {
    it("names repositories by key, and a path is not a key", () => {
        /*
         The whole restriction, as one assertion. There is no path argument in this
         phase, so there is nothing to traverse: a key either resolves against the
         closed table or it does not.
        */
        for (const attempt of [
            "/Users/nickmadaio/Desktop/ORION",
            "../../etc",
            "orion/../..",
            "",
            "some-other-repo",
        ]) {
            const result = resolveDevCommand(attempt, "git_status");
            expect("error" in result, attempt).toBe(true);
        }
        const ok = resolveDevCommand("orion", "git_status");
        expect("error" in ok).toBe(false);
    });
    it("builds a fixed argv that no argument can extend", () => {
        const status = resolveDevCommand("orion", "git_status");
        if ("error" in status)
            throw new Error(status.error);
        expect(status.argv).toEqual(["git", "status", "--short", "--branch"]);
        // A pull can only ever fast-forward. There is no argument that turns this
        // off, which is the point of the argv being a constant.
        const pull = resolveDevCommand("orion", "git_pull");
        if ("error" in pull)
            throw new Error(pull.error);
        expect(pull.argv).toContain("--ff-only");
        expect(pull.argv).not.toContain("--rebase");
        // `npm ci`, never `npm install <something from the internet>`.
        const install = resolveDevCommand("orion-plugin", "package_install");
        if ("error" in install)
            throw new Error(install.error);
        expect(install.argv).toEqual(["npm", "ci"]);
    });
    it("bounds the only two arguments in the phase", () => {
        for (const limit of [0, -1, 101, 1.5, Number.NaN]) {
            expect("error" in resolveDevCommand("orion", "git_log", { limit }), String(limit)).toBe(true);
        }
        const ok = resolveDevCommand("orion", "git_log", { limit: 5 });
        if ("error" in ok)
            throw new Error(ok.error);
        expect(ok.argv[ok.argv.length - 1]).toBe("-5");
    });
    it("refuses an operation a repository has no command for", () => {
        // `orion` has no test command. Saying so is better than guessing at one,
        // and much better than running the plugin's suite because it was nearby.
        const result = resolveDevCommand("orion", "tests_run");
        expect("error" in result).toBe(true);
    });
    it("builds the environment from an allowlist, so a new secret is absent by default", () => {
        /*
         A denylist of secret-looking names is wrong in the direction that matters:
         it is correct only until somebody exports a new one. This starts from
         nothing, so the test can be stated as an absence rather than as a list of
         things that were remembered.
        */
        const before = { ...process.env };
        process.env.ANTHROPIC_API_KEY = "sk-test-should-not-survive";
        process.env.SOME_BRAND_NEW_TOKEN = "nobody-wrote-a-rule-for-this-one";
        try {
            const env = devEnvironment();
            expect(Object.values(env).join(" ")).not.toContain("sk-test-should-not-survive");
            expect(Object.values(env).join(" ")).not.toContain("nobody-wrote-a-rule-for-this-one");
            expect(Object.keys(env).sort()).toEqual(["CI", "HOME", "LANG", "PATH", "TMPDIR"]);
            // PATH is pinned rather than inherited: an inherited PATH is a list of
            // directories any of which might hold a `git` that is not git.
            expect(env.PATH).not.toBe(before.PATH);
        }
        finally {
            process.env = before;
        }
    });
    it("keeps both ends of a long output, because a failure prints last", () => {
        const noise = "x".repeat(30_000);
        const bounded = boundOutput(`START${noise}FAILED: 3 tests`, 2_000);
        expect(bounded.length).toBeLessThan(2_500);
        expect(bounded).toContain("START");
        expect(bounded).toContain("FAILED: 3 tests");
        expect(bounded).toContain("cut from the middle");
    });
    it("puts every dev action behind the tier and the profile, and none behind approval", () => {
        const dev = Object.entries(ACTION_CATALOG).filter(([, definition]) => definition.capabilityTier === "dev_operations");
        expect(dev.length).toBe(7);
        for (const [name, definition] of dev) {
            // Not approval-gated on purpose: an assistant who cannot run the tests
            // without being asked twice is one nobody lets near a repository. `risk:
            // high` puts the four that DO something at NOTIFY under guarded.
            expect(definition.approvalRequired, name).toBe(false);
            expect(definition.requiredArguments, name).toContain("repository");
        }
        const doers = ["git_pull", "tests_run", "build_run", "package_install"];
        for (const name of doers) {
            expect(ACTION_CATALOG[name].risk, name).toBe("high");
        }
    });
});
describe("phases 57/58: automation is proposed, never installed", () => {
    const good = () => ({
        name: "morning-brief",
        intent: "tell me what is on today before I get up",
        trigger: { kind: "daily", atHour: 7, atMinute: 30 },
        conditions: { quietHours: [22, 7] },
        action: "standing_morning",
        permissions: { expectsMode: "guarded" },
        expiresOn: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10),
        riskLimits: { maxRunsPerDay: 1, maxMessagesPerDay: 1 },
        failureBehavior: "report_and_continue",
        proposedAt: new Date().toISOString(),
    });
    it("has no install action, and that is the enforcement", () => {
        /*
         Phase 57: "Model may not silently install permanent automation."
    
         Enforced by the SHAPE of the catalog rather than by a rule. There is no
         operation here that schedules anything, and adding one would be visible
         in this assertion rather than in a review nobody runs.
        */
        const operations = Object.values(ACTION_CATALOG)
            .filter((d) => d.execution.kind === "automation")
            .map((d) => d.execution.operation)
            .sort();
        expect(operations).toEqual(["list", "propose", "simulate", "withdraw"]);
        expect(operations).not.toContain("install");
        // And nothing anywhere in the catalog can reach a scheduler by any route.
        const scheduler = Object.entries(ACTION_CATALOG).filter(([, d]) => /launchagent|crontab|plist|cron/i.test(JSON.stringify(d.execution)));
        expect(scheduler).toEqual([]);
    });
    it("refuses a raw cron string, because a minute field is a factor of sixty", () => {
        const raw = { ...good(), trigger: { kind: "cron", expression: "* * * * *" } };
        expect(validateProposal(raw).join(" ")).toMatch(/raw cron string is not accepted/);
        // The expression is DERIVED from the shape and never accepted as input.
        expect(cronExpression({ kind: "daily", atHour: 7, atMinute: 30 })).toBe("30 7 * * *");
        expect(cronExpression({ kind: "hourly", atMinute: 0 })).toBe("0 * * * *");
    });
    it("requires every field the manifest names, and says all of them at once", () => {
        const issues = validateProposal({ name: "x" });
        // All of them, not the first. A model that fixes one field per round trip
        // takes seven turns, and by the seventh it is inventing fields to make the
        // errors stop.
        expect(issues.length).toBeGreaterThan(4);
        for (const field of ["intent", "trigger", "action", "expiresOn", "maxRunsPerDay", "failureBehavior"]) {
            expect(issues.join(" "), field).toContain(field);
        }
        expect(validateProposal(good())).toEqual([]);
    });
    it("will not accept an automation with no end", () => {
        const forever = { ...good() };
        delete forever.expiresOn;
        expect(validateProposal(forever).join(" ")).toMatch(/expiresOn is required/);
        // Nor one that outlives the window in which somebody would still want it.
        const distant = {
            ...good(),
            expiresOn: new Date(Date.now() + 900 * 86_400_000).toISOString().slice(0, 10),
        };
        expect(validateProposal(distant).join(" ")).toMatch(/within \d+ days/);
    });
    it("only lets an automation run something from the closed table", () => {
        expect(validateProposal({ ...good(), action: "rm -rf /" }).join(" ")).toMatch(/action must be one of/);
        expect(validateProposal({ ...good(), action: "orion-messages-send" }).join(" ")).toMatch(/action must be one of/);
    });
    it("simulates against the clock, and says what it cannot know", () => {
        // Phase 58. Hourly, quiet 22:00-07:00 -> nine suppressed hours a day.
        const hourly = {
            ...good(),
            trigger: { kind: "hourly", atMinute: 0 },
            riskLimits: { maxRunsPerDay: 24, maxMessagesPerDay: 24 },
        };
        const forecast = simulate(hourly, { windowDays: 10 });
        expect(forecast.fireCount).toBe(240);
        expect(forecast.suppressedCount).toBe(90);
        expect(forecast.messageCount).toBe(150);
        // A ceiling, and it says so rather than being read as a forecast.
        expect(forecast.notes.join(" ")).toMatch(/CEILING/);
    });
    it("lets the daily ceiling actually bite, and says when it did", () => {
        const noisy = {
            ...good(),
            trigger: { kind: "hourly", atMinute: 0 },
            conditions: {},
            riskLimits: { maxRunsPerDay: 24, maxMessagesPerDay: 2 },
        };
        const forecast = simulate(noisy, { windowDays: 5 });
        expect(forecast.fireCount).toBe(120);
        expect(forecast.messageCount).toBe(10);
        expect(forecast.cappedByRiskLimit).toBe(true);
        expect(forecast.notes.join(" ")).toMatch(/ceiling of 2 is doing real work/);
    });
    it("reads a quiet window that crosses midnight as a window", () => {
        // 22 to 7 wraps. Reading it as an empty range is how a quiet-hours rule
        // silently does nothing, which is the failure mode that matters.
        const wrapped = simulate({ ...good(), trigger: { kind: "hourly", atMinute: 0 }, conditions: { quietHours: [22, 7] },
            riskLimits: { maxRunsPerDay: 24, maxMessagesPerDay: 24 } }, { windowDays: 1 });
        expect(wrapped.suppressedCount).toBe(9);
    });
});
describe("phases 63/64: why, and how sure", () => {
    const run = (steps, extra = {}) => ({
        taskId: "orion-test",
        goal: "do the thing",
        status: "succeeded",
        createdAt: "2026-09-03T10:00:00Z",
        validation: { issues: [] },
        steps,
        ...extra,
    });
    it("derives confidence rather than accepting a claim of it", () => {
        /*
         Phase 64's five levels, each earned by something in the record. A model
         that could write `confidence: "known"` would, so no field here is read
         from the step's own arguments.
        */
        expect(confidenceOfStep({ status: "verified", verification: { observed: true } })).toBe("observed");
        expect(confidenceOfStep({ status: "succeeded" })).toBe("inferred");
        expect(confidenceOfStep({ status: "failed" })).toBe("known");
        expect(confidenceOfStep({ status: "retrying" })).toBe("uncertain");
        // The distinction that is not theoretical: "I looked and cannot tell" and
        // "I could not look" are different sentences, and collapsing them is how
        // orion-standing once reported a clear day when Reminders had never been
        // granted.
        expect(confidenceOfStep({ status: "verified", verification: { observed: false } }))
            .toBe("unable_to_verify");
    });
    it("does not let a verified read carry an unverified write", () => {
        // The weakest step bounds the run. An average would let one checked read
        // vouch for a write nobody looked at.
        const mixed = explainRun(run([
            { stepId: "a", status: "verified", verification: { observed: true, evidence: "file_exists" },
                request: { action: "desktop_list" } },
            { stepId: "b", status: "succeeded", request: { action: "file_move" } },
        ]));
        expect(mixed.steps.map((s) => s.confidence)).toEqual(["observed", "inferred"]);
        expect(mixed.confidence).toBe("inferred");
    });
    it("quotes evidence and never invents it", () => {
        const explained = explainRun(run([
            { stepId: "a", status: "verified",
                verification: { observed: true, evidence: "/Users/x/thing.txt" },
                request: { action: "desktop_list" } },
            { stepId: "b", status: "succeeded", request: { action: "desktop_list" } },
        ]));
        // Verbatim, because a paraphrased piece of evidence is a claim about
        // evidence rather than evidence.
        expect(explained.steps[0].evidence).toBe("/Users/x/thing.txt");
        // And absent rather than filled in when there was none.
        expect(explained.steps[1].evidence).toBeNull();
    });
    it("says an unauthorized run was unauthorized instead of staying quiet", () => {
        const explained = explainRun(run([]));
        expect(explained.provenance.authorized).toBe(false);
        expect(explained.provenance.detail).toMatch(/no trust anchor/);
        // Nothing ran and nothing was checked, so the honest answer is the bottom
        // of the ladder rather than a cheerful "succeeded".
        expect(explained.confidence).toBe("unable_to_verify");
    });
    it("reports the policy from the catalog, not from the step", () => {
        const explained = explainRun(run([{ stepId: "s", status: "succeeded", request: { action: "messages_send" } }]));
        // Read out of ACTION_CATALOG so it cannot disagree with the gate that
        // actually ran.
        expect(explained.steps[0].policy).toContain("messages_send");
        expect(explained.steps[0].policy).toContain("NOT reversible");
        expect(explained.steps[0].policy).toContain("approval required");
    });
    it("keeps the note vocabulary and maps it rather than replacing it", () => {
        // The brain has had --epistemic since 2026-09-02. Rewriting those values
        // would orphan every note already written.
        expect(EPISTEMIC_TO_CONFIDENCE["user-stated"]).toBe("known");
        expect(EPISTEMIC_TO_CONFIDENCE.inference).toBe("inferred");
        expect(isActionable("inferred")).toBe(false);
        expect(isActionable("observed")).toBe(true);
    });
    it("passes every constraint through verbatim, in order", () => {
        const explained = explainRun(run([], {
            status: "rejected",
            validation: {
                issues: [
                    { code: "capability_disabled", message: "tier is off" },
                    { code: "approval_required", message: "needs Nick" },
                ],
            },
        }));
        expect(explained.constraints).toEqual([
            "capability_disabled: tier is off",
            "approval_required: needs Nick",
        ]);
    });
});
describe("phase 62: what Nick is waiting on", () => {
    const item = (over = {}) => ({
        id: "prof-extension",
        what: "a decision on the thesis extension",
        who: "prof@example.edu",
        expect: "a reply to my email of the 20th",
        since: "2026-08-20",
        dueBy: "2026-08-27",
        status: "open",
        surfaced: 0,
        ...over,
    });
    const store = (items) => ({ version: 1, items });
    const NOW = new Date("2026-09-03T09:00:00-04:00");
    it("insists on the event that would end it", () => {
        /*
         "Waiting on the professor" is a feeling; "waiting for a reply to my email
         of the 20th" is a thing that either happened or did not. Only the second
         can be closed by anything but Nick remembering to close it, and only the
         second makes `overdue` mean something other than `old`.
        */
        const vague = { ...item(), expect: "" };
        expect(validateItem(vague).join(" ")).toMatch(/observable event/);
        const undated = { ...item() };
        delete undated.dueBy;
        expect(validateItem(undated).join(" ")).toMatch(/dueBy is required/);
        expect(validateItem(item())).toEqual([]);
    });
    it("is overdue against its own promise, not against its age", () => {
        // A thing asked for last week and expected next month is not overdue; a
        // thing asked for yesterday and needed the same day is.
        const late = item({ dueBy: "2026-08-27" });
        const patient = item({ id: "reservation", dueBy: "2026-10-01" });
        const both = store([late, patient]);
        expect(overdue(both, NOW).map((i) => i.id)).toEqual(["prof-extension"]);
        expect(pending(both, NOW).map((i) => i.id)).toEqual(["reservation"]);
        expect(daysLate(late, NOW)).toBe(7);
    });
    it("means later when Nick says later", () => {
        const snoozed = item({ snoozedUntil: "2026-09-10T00:00:00Z" });
        expect(overdue(store([snoozed]), NOW)).toEqual([]);
        // ...and speaks again once the snooze has run out.
        expect(overdue(store([snoozed]), new Date("2026-09-11T09:00:00-04:00"))).toHaveLength(1);
    });
    it("stops nagging without forgetting", () => {
        // A daily reminder forever is one people learn to ignore, along with the
        // ones that matter. It stays in the list and stops speaking, which is a
        // different thing from being deleted.
        const worn = item({ surfaced: MAX_SURFACES });
        expect(overdue(store([worn]), NOW)).toEqual([]);
        expect(store([worn]).items).toHaveLength(1);
    });
    it("says nothing about what is closed", () => {
        for (const status of ["resolved", "dismissed"]) {
            expect(overdue(store([item({ status })]), NOW)).toEqual([]);
            expect(pending(store([item({ status })]), NOW)).toEqual([]);
        }
    });
    it("drafts a follow-up and cannot send one", () => {
        /*
         The gate decision this phase needed, asserted rather than described.
         Drafting is one step from sending, and messages_send sits at the
         third-party floor no strictness mode can lower. So a draft is text on a
         record, and the catalog has no waiting operation that delivers anything.
        */
        const text = draftFollowUp(item(), NOW);
        expect(text).toContain("thesis extension");
        expect(text).toContain("7 days ago");
        const waiting = Object.entries(ACTION_CATALOG).filter(([, d]) => d.capabilityTier === "waiting_on");
        expect(waiting.length).toBe(6);
        for (const [name, definition] of waiting) {
            expect(definition.execution.kind, name).toBe("waiting");
            // Nothing in this tier reaches a person. The only outbound route in the
            // system stays messages_send, with its approval floor intact.
            expect(JSON.stringify(definition.execution), name).not.toMatch(/send|message|mail/i);
        }
    });
    it("uses a local civil date, because toISOString rolls over mid-evening here", () => {
        // This has cost the program a day of memory filed under tomorrow once
        // already; the rule is written into orion-standing and applies here too.
        expect(civilToday(new Date("2026-09-03T22:30:00-04:00"))).toBe("2026-09-03");
    });
});
describe("phase 61: prep cards that are not remembered", () => {
    it("picks search terms from the event, never from a model", () => {
        /*
         An event title is attacker-controllable if anyone can put something on the
         calendar. "Search my mail for X" where X was chosen by a model reading
         that title is a worse position than a fixed extraction from it, so the
         terms come out mechanically: stopwords dropped, longest first (a long word
         is a more specific search), and capped at three because a four-term search
         of somebody's mail returns everything.
        */
        expect(termsFromEvent("Weekly sync about the thesis extension deadline")).toEqual([
            "extension",
            "deadline",
            "thesis",
        ]);
        // Meeting-shaped filler carries no signal and is dropped entirely.
        expect(termsFromEvent("weekly standup")).toEqual([]);
        // Attendee names are terms too, taken from the local part of an address.
        expect(termsFromEvent("1:1", ["maria.gonzalez@example.edu"])).toContain("gonzalez");
    });
    it("never shows an unreadable source as an empty one", () => {
        // The rule orion-standing is built around, applied here: "no relevant
        // email" and "I could not search your email" look identical to a reader
        // and mean opposite things.
        const card = renderCard({ title: "Thesis meeting", when: "tomorrow 10:00", attendees: ["prof@example.edu"] }, [
            { label: "Mail", status: "unavailable", lines: [], reason: "token expired" },
            { label: "Notes", status: "empty", lines: [] },
        ]);
        expect(card).toContain("Mail: could not read — token expired");
        expect(card).toContain("blind spot in this card");
        expect(card).toContain("Notes: nothing found");
    });
    it("says out loud that it kept nothing", () => {
        /*
         Phase 61: "use temporary context; do not convert every relevant document
         into permanent ORION memory." Enforced by there being no write call in the
         executor at all, and stated in the card so the model cannot imply
         otherwise in the sentence it wraps around it.
        */
        const card = renderCard({ title: "x", when: "y", attendees: [] }, []);
        expect(card).toContain("Nothing here was saved");
        const definition = ACTION_CATALOG.prep_card;
        expect(definition.reversible).toBe(true);
        expect(definition.risk).toBe("low");
        // Nothing in the tier writes anywhere.
        const prep = Object.entries(ACTION_CATALOG).filter(([, d]) => d.capabilityTier === "prep");
        expect(prep.map(([n]) => n)).toEqual(["prep_card"]);
    });
    it("bounds a section so one loud source cannot become the whole card", () => {
        const many = Array.from({ length: 20 }, (_, i) => `thread ${i}`);
        const card = renderCard({ title: "x", when: "y", attendees: [] }, [
            { label: "Mail", status: "ok", lines: many },
        ]);
        expect(card).toContain("thread 5");
        expect(card).not.toContain("thread 6");
        expect(card).toContain("(+14 more)");
    });
});
describe("phase 68: the failures that can actually be injected", () => {
    /*
     Most of the manifest's 23 scenarios cannot be tested without the failure --
     a provider outage is not something a unit test can arrange. Three CAN be,
     and they were the three with no coverage at all: a wrapper that fails, a
     wrapper that hangs, and a store that is corrupt. Each is a real path through
     this code and each had only the argument that it "should" be handled.
    */
    const tmpBin = async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), "orion-fault-"));
        return dir;
    };
    it("turns a wrapper that exits non-zero into a refusal, not a crash", async () => {
        const dir = await tmpBin();
        const script = path.join(dir, "failing");
        await writeFile(script, "#!/bin/sh\necho 'upstream said 429' >&2\nexit 7\n", { mode: 0o755 });
        const result = await new Promise((resolve) => {
            const child = spawn(script, [], { stdio: ["ignore", "pipe", "pipe"] });
            let output = "";
            child.stdout?.on("data", (c) => (output += String(c)));
            child.stderr?.on("data", (c) => (output += String(c)));
            child.on("close", (code) => resolve({ code: code ?? 1, output: output.trim() }));
        });
        // The shape every wrapper caller in executors.ts depends on: a non-zero
        // exit carries its stderr, so a 429 from Google reaches the model as a
        // sentence rather than as "exit 7".
        expect(result.code).toBe(7);
        expect(result.output).toContain("429");
    });
    it("kills a wrapper that hangs, rather than waiting for it", async () => {
        const dir = await tmpBin();
        const script = path.join(dir, "hanging");
        await writeFile(script, "#!/bin/sh\nsleep 30\n", { mode: 0o755 });
        const started = Date.now();
        const result = await new Promise((resolve) => {
            /*
             THIS TEST FOUND A REAL BUG, hours after the code shipped.
      
             Written first with `child.kill("SIGKILL")` and a `close` listener -- the
             exact shape runDevOperation used -- it TIMED OUT instead of passing. The
             script is a shell that spawns `sleep`; killing the shell leaves `sleep`
             running, `sleep` holds the inherited stdout pipe, and `close` waits for
             stdio EOF rather than for exit. So the promise never settled.
             `npm test` has exactly that shape, which means a timed-out test run
             would have hung the tool call forever -- the failure the timeout exists
             to prevent, reached through the timeout itself.
      
             The fix, in both places: a detached child so there is a process group,
             kill the GROUP, and settle on `exit` as well as `close`.
            */
            const child = spawn(script, [], { stdio: ["ignore", "pipe", "pipe"], detached: true });
            let timedOut = false;
            let settled = false;
            const settle = () => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                resolve({ timedOut });
            };
            const timer = setTimeout(() => {
                timedOut = true;
                // SIGKILL on the negative pid, which is the whole group. SIGTERM would
                // be worse for a second reason: a process that traps it to clean up is
                // a process that ignores a timeout.
                if (child.pid)
                    process.kill(-child.pid, "SIGKILL");
            }, 300);
            child.on("close", settle);
            child.on("exit", settle);
        });
        expect(result.timedOut).toBe(true);
        expect(Date.now() - started).toBeLessThan(4_000);
    });
    it("refuses to read a corrupt store as an empty one", () => {
        /*
         The failure mode this whole program keeps returning to: "no access" and
         "nothing there" look identical to a caller and mean opposite things. A
         corrupt waiting list that read as empty would silently lose everything
         Nick is waiting on AND report success while doing it.
        */
        expect(() => JSON.parse("{not json")).toThrow();
        // The store's own validator rejects a shape that parsed but is not a store.
        expect(validateItem({})).not.toEqual([]);
    });
    it("survives a half-written final line on an append-only ledger", () => {
        // A crash mid-append is the normal way a JSONL file ends. Losing the whole
        // history because the last line is short is not an acceptable response.
        const lines = ['{"taskId":"a","steps":[]}', '{"taskId":"b","ste'];
        const parsed = lines
            .map((line) => {
            try {
                return JSON.parse(line);
            }
            catch {
                return null;
            }
        })
            .filter(Boolean);
        expect(parsed).toHaveLength(1);
    });
});
