import { createHash, randomBytes, randomInt } from "node:crypto";
import { hostname } from "node:os";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
/*
 THE HUMAN, PUT BACK INTO THE APPROVAL GATE.

 ## What was actually happening

 `validator.ts` refuses an action marked `approvalRequired` unless the step
 carries `approval.canonicalHash` equal to a hash the validator computes from
 the action, its arguments and the working context. That binding is real and
 worth keeping: it means an approval for one message cannot be replayed against
 a different one.

 It is also, on its own, satisfiable by the thing it is meant to restrain. The
 first call returns `needs_approval` together with the canonical hash. The
 model copies that hash into a second call. The gate opens. No person is
 consulted at any point, and the transcript reads exactly like a real approval:
 a refusal, then a grant, then the action. Phase 49 names this in one line --
 "the agent must not be able to satisfy an approval gate by supplying the hash
 itself" -- and it was true of this system when that line was written.

 The same hole existed a second time, in `orion-remote`: its `approve` verb
 resolves a pending item, `orion-remote` is on Orion's exec allowlist, and a
 direct `orion-remote handle` call defaults its sender to `local`, which is an
 allowed sender. Orion could answer his own approval requests over the channel
 built for Nick to answer them.

 ## The shape of the fix

 Two files in two places, and the whole argument is which process may write
 which one:

   TICKET   minted by the plugin when a gate stops. Says what is waiting, in
            words, with an id a person can read out. Orion may read these --
            he has to, to tell Nick the id.
   GRANT    written ONLY by `orion-approve`, or by `orion-remote` acting on a
            message from a non-local allowlisted sender. Says that a person
            said yes to one exact canonical hash, once.

 ## Where the boundary really is, stated honestly

 Orion runs as Nick's user. There is no kernel privilege boundary here and
 pretending otherwise would be worse than having none. The boundary is that
 NOTHING ORION CAN INVOKE WRITES TO THE GRANT DIRECTORY:

   · no `ACTION_CATALOG` execution kind can produce a path there -- the mutable
     roots are the two workspaces and the Desktop, and this is under
     `~/.openclaw`;
   · `orion-approve` is deliberately absent from the exec allowlist, so the
     call is denied rather than prompted (`ask: off`, `askFallback: deny`);
   · `orion-approve` is in `FORBIDDEN_SCRIPTS`, so the self-repair engine will
     not edit it -- the thing that vouches for changes cannot vouch for a
     change to itself;
   · `orion-remote` refuses `approve` from the `local` sender, which is the
     only sender an exec call can present.

 Each of those is checked by a test, because a boundary made of four claims is
 only as good as the one nobody re-checks.

 ## Single use, bound, and short

 A grant carries the canonical hash AND the nonce from its ticket, and is moved
 to `used/` the moment it is spent. Phase 45 already learned this on the remote
 job gate: a resent identifier is indistinguishable from a captured one, so the
 gate must never have to guess which it is holding.
*/
/** Unambiguous when read aloud or typed: no 0/O, no 1/I/L. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const TICKET_RE = /^A-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;
/**
 * How a person may write the id back.
 *
 * Phase 49: "make every authorization check satisfiable by the name a person
 * would actually type". So `a-7f3k`, `A-7F3K` and a bare `7F3K` are the same
 * ticket, and nothing here invents a token nobody would write.
 */
export function normalizeTicketId(raw) {
    const compact = String(raw ?? "").trim().toUpperCase().replace(/^A-/, "");
    return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(compact) ? `A-${compact}` : null;
}
const mintId = () => `A-${Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`;
/** Long enough to walk to a terminal, short enough that a stale yes is gone. */
export const TICKET_TTL_MS = 15 * 60 * 1000;
export function approvalPaths(root) {
    return {
        tickets: path.join(root, "tickets"),
        grants: path.join(root, "grants"),
        used: path.join(root, "used"),
    };
}
const readJsonFile = (file) => {
    try {
        return JSON.parse(readFileSync(file, "utf8"));
    }
    catch {
        return null;
    }
};
const listJson = (directory) => {
    try {
        return readdirSync(directory).filter((name) => name.endsWith(".json"));
    }
    catch {
        return [];
    }
};
/**
 * Live tickets, newest first. Synchronous so callers that must stay pure can
 * use it; the directory holds at most a handful of files by construction.
 */
export function readTickets(paths, now = new Date()) {
    return listJson(paths.tickets)
        .map((name) => readJsonFile(path.join(paths.tickets, name)))
        .filter((ticket) => ticket !== null)
        .filter((ticket) => Date.parse(ticket.expiresAt) > now.getTime())
        // A ticket minted on another Mac is not this Mac's to answer. Tickets
        // written before this field existed carry no deviceId and are still
        // honoured here rather than silently dropped.
        .filter((ticket) => !ticket.deviceId || ticket.deviceId === hostname())
        .sort((a, b) => b.mintedAt.localeCompare(a.mintedAt));
}
/**
 * Which canonical hashes a person has actually approved.
 *
 * A grant counts only when its ticket still exists, has not expired, and
 * carries the same nonce. That is what makes a grant unforgeable without also
 * forging the plugin's own mint: writing a grant for a hash you can compute is
 * not enough, you need the nonce that only the ticket has.
 */
export function grantedHashes(paths, now = new Date()) {
    const tickets = new Map(readTickets(paths, now).map((ticket) => [ticket.id, ticket]));
    const resolved = new Map();
    for (const name of listJson(paths.grants)) {
        const grant = readJsonFile(path.join(paths.grants, name));
        if (!grant)
            continue;
        const ticket = tickets.get(grant.id);
        if (!ticket)
            continue;
        if (ticket.nonce !== grant.nonce)
            continue;
        if (ticket.canonicalHash !== grant.canonicalHash)
            continue;
        resolved.set(grant.canonicalHash, { grant, ticket });
    }
    return resolved;
}
/**
 * Mint a ticket, or return the one already waiting for this exact hash.
 *
 * Deduplication is a safety property rather than a nicety. Without it a model
 * that retries produces a new id per attempt, Nick's phone fills with codes
 * that all mean the same thing, and the one he eventually types is whichever
 * he happened to read -- which is how a person ends up approving something
 * they have stopped reading.
 */
export async function mintTicket(paths, request, now = new Date()) {
    const existing = readTickets(paths, now).find((ticket) => ticket.canonicalHash === request.canonicalHash);
    if (existing)
        return existing;
    await mkdir(paths.tickets, { recursive: true, mode: 0o700 });
    const ticket = {
        id: mintId(),
        canonicalHash: request.canonicalHash,
        // 128 bits from the CSPRNG, not a hash of a timestamp. The nonce is the
        // one value a forger cannot compute from the ticket's public contents, so
        // it must not be derivable from them.
        nonce: randomBytes(16).toString("hex"),
        action: request.action,
        summary: request.summary,
        context: request.context,
        mintedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + TICKET_TTL_MS).toISOString(),
        deviceId: hostname(),
        ...(request.sessionKey ? { sessionKey: request.sessionKey } : {}),
    };
    // `wx`: a collision on the four-character id must fail rather than overwrite
    // a ticket somebody is about to approve.
    await writeFile(path.join(paths.tickets, `${ticket.id}.json`), `${JSON.stringify(ticket, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    return ticket;
}
/**
 * Spend a grant. Called once the gate has been satisfied and BEFORE the action
 * runs, so a failed action costs the approval rather than leaving one lying
 * around that a later attempt could pick up.
 */
export async function consumeGrant(paths, canonicalHash, now = new Date()) {
    const match = grantedHashes(paths, now).get(canonicalHash);
    if (!match)
        return false;
    await mkdir(paths.used, { recursive: true, mode: 0o700 });
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    // The rename is the spend. Two calls racing for one grant both read it as
    // present; only one rename can succeed, and the loser must not run.
    const spent = await rename(path.join(paths.grants, `${match.grant.id}.json`), path.join(paths.used, `${match.grant.id}-${stamp}.json`)).then(() => true, () => false);
    if (!spent)
        return false;
    await rename(path.join(paths.tickets, `${match.ticket.id}.json`), path.join(paths.used, `${match.ticket.id}-${stamp}.ticket.json`)).catch(() => undefined);
    return true;
}
/**
 * Write the grant. The one function in this file that represents a person
 * having said yes, and it is exported only for `orion-approve` and the
 * non-local branch of `orion-remote` -- nothing in the plugin's tool surface
 * calls it.
 */
export async function grant(paths, ticketId, grantedBy, now = new Date()) {
    const id = normalizeTicketId(ticketId);
    if (!id)
        return { ok: false, reason: `"${String(ticketId).slice(0, 20)}" is not an approval id` };
    if (!grantedBy || grantedBy.toLowerCase() === "local" || grantedBy.toLowerCase() === "orion") {
        // The whole point. An approval has to be attributable to a person, and
        // `local` is what an exec call from Orion himself presents.
        return { ok: false, reason: "an approval must come from a named person, not from the local process" };
    }
    const ticket = readTickets(paths, now).find((candidate) => candidate.id === id);
    if (!ticket)
        return { ok: false, reason: `no approval ${id} is waiting (it may have expired)` };
    await mkdir(paths.grants, { recursive: true, mode: 0o700 });
    const record = {
        id: ticket.id,
        canonicalHash: ticket.canonicalHash,
        nonce: ticket.nonce,
        grantedAt: now.toISOString(),
        grantedBy,
    };
    const written = await writeFile(path.join(paths.grants, `${ticket.id}.json`), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600 }).then(() => null, (error) => error);
    if (written) {
        // Already granted is fine only if it is the same grant; anything else is a
        // stale or foreign file, and saying "ok" would make a real yes a no-op.
        const existing = readJsonFile(path.join(paths.grants, `${ticket.id}.json`));
        if (!(written.code === "EEXIST" && existing?.canonicalHash === ticket.canonicalHash && existing?.nonce === ticket.nonce)) {
            return { ok: false, reason: `the approval could not be recorded (${written.code ?? "unknown"})` };
        }
    }
    return { ok: true, ticket };
}
/*
 PHASE 52: "allow for this chat".

 Nick asked for the choice the chat apps give: allow this once, or allow it for
 the rest of this conversation. A chat grant covers ONE action (only those in
 CHAT_GRANTABLE -- today, terminal_run) in ONE conversation (the ticket's
 session), for at most CHAT_GRANT_TTL_MS, and is written by the same human-only
 writers as any grant. It never reaches another chat, another action, or the
 floor's other R5 actions (messages, screen control), which stay once-each.
*/
export const CHAT_GRANTABLE = new Set(["terminal_run"]);
export const CHAT_GRANT_TTL_MS = 8 * 60 * 60 * 1000;
const chatFile = (paths, sessionKey) => path.join(path.dirname(paths.grants), "chat", `${createHash("sha256").update(sessionKey).digest("hex").slice(0, 32)}.json`);
export async function grantForChat(paths, ticketId, grantedBy, now = new Date()) {
    const id = normalizeTicketId(ticketId);
    const ticket = id ? readTickets(paths, now).find((candidate) => candidate.id === id) : undefined;
    if (!ticket)
        return { ok: false, reason: `no approval ${String(ticketId).slice(0, 20)} is waiting (it may have expired)` };
    if (!CHAT_GRANTABLE.has(ticket.action))
        return { ok: false, reason: `${ticket.action} can only be allowed once at a time` };
    if (!ticket.sessionKey)
        return { ok: false, reason: "this request did not come from a chat, so there is no chat to allow it for" };
    const once = await grant(paths, ticket.id, grantedBy, now);
    if (!once.ok)
        return once;
    const file = chatFile(paths, ticket.sessionKey);
    const existing = readJsonFile(file);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, `${JSON.stringify({
        sessionKey: ticket.sessionKey,
        actions: [...new Set([...(existing?.actions ?? []), ticket.action])],
        grantedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + CHAT_GRANT_TTL_MS).toISOString(),
        grantedBy,
        fromTicket: ticket.id,
        deviceId: hostname(),
    }, null, 2)}\n`, { mode: 0o600 });
    return { ok: true, ticket };
}
/** Whether Nick allowed `action` for the rest of this chat, and it has not run out. */
export function chatGrantCovers(paths, sessionKey, action, now = new Date()) {
    if (!sessionKey || !CHAT_GRANTABLE.has(action))
        return false;
    const record = readJsonFile(chatFile(paths, sessionKey));
    if (!record || record.sessionKey !== sessionKey || record.deviceId !== hostname())
        return false;
    if (!record.grantedBy || ["local", "orion"].includes(record.grantedBy.toLowerCase()))
        return false;
    // Never longer than the TTL from when it was given, whatever the file says,
    // and only if the one-shot grant it came from really exists.
    const granted = Date.parse(record.grantedAt ?? "");
    const ends = Math.min(Date.parse(record.expiresAt ?? ""), granted + CHAT_GRANT_TTL_MS);
    if (!Number.isFinite(ends) || ends <= now.getTime() || !(record.actions ?? []).includes(action))
        return false;
    return typeof record.fromTicket === "string" && grantRecordExists(paths, record.fromTicket);
}
function grantRecordExists(paths, ticketId) {
    if (!normalizeTicketId(ticketId))
        return false;
    if (existsSync(path.join(paths.grants, `${ticketId}.json`)))
        return true;
    try {
        return readdirSync(paths.used).some((name) => name.startsWith(`${ticketId}-`) && !name.endsWith(".ticket.json"));
    }
    catch {
        return false;
    }
}
/** Withdraw every chat grant: `orion-approve revoke-chat`, and the panic lock. */
export async function revokeChatGrants(paths) {
    const directory = path.join(path.dirname(paths.grants), "chat");
    let names = [];
    try {
        names = readdirSync(directory).filter((name) => name.endsWith(".json"));
    }
    catch {
        return 0;
    }
    await Promise.all(names.map((name) => unlink(path.join(directory, name)).catch(() => undefined)));
    return names.length;
}
/** Withdraw a waiting request without approving it. */
export async function deny(paths, ticketId, now = new Date()) {
    const id = normalizeTicketId(ticketId);
    if (!id)
        return false;
    const ticket = readTickets(paths, now).find((candidate) => candidate.id === id);
    if (!ticket)
        return false;
    await mkdir(paths.used, { recursive: true, mode: 0o700 });
    await rename(path.join(paths.tickets, `${ticket.id}.json`), path.join(paths.used, `${ticket.id}-denied-${now.toISOString().replace(/[:.]/g, "-")}.json`)).catch(() => undefined);
    return true;
}
// MARK: - Saying yes out loud
/*
 THE VOICE PATH, and why it is not a voice feature.

 `orion-approve` and the Discord verb both work because they are acts Orion
 cannot perform. Speech looked like it had no equivalent: the microphone feeds
 a transcript to the model, and the model is precisely what was removed from
 the loop.

 The first design was speaker verification -- accept "approve A-7F3K" when the
 voice matches Nick's enrolled profile. `SpeakerVerifier.swift` forbids it in
 its own header, and it is right to:

     IT IS NOT AUTHENTICATION. It filters the television and the room. A
     recording of his voice defeats it, and nothing security-relevant should
     ever be conditioned on it.

 It also fails OPEN by design, so building an approval on it would mean an
 approval that succeeds when the daemon is down.

 The mechanism that does work was already here, already tested, and already
 trusted for a decision of the same weight. `authorizeTaskGraph` mints
 `trusted_user` inputs from OpenClaw host provenance; a model-supplied input
 becomes `untrusted_external` and a forged `trusted_user` tag is discarded
 (`ignores a model-forged trusted_user tag and fails closed`). That is the same
 proof `argumentNotFromUser` leans on to decide whether Nick named the person a
 message is going to.

 So: if NICK'S OWN TURN says approve, that is a person saying yes. It works for
 speech, for a typed message and for the Discord DM identically, because none
 of them is special -- what matters is that the words came from the harness and
 not from the model.

 WHAT THIS DOES NOT DEFEND. Anyone standing in the room can say it. That is
 the same exposure as anyone standing at the keyboard, and it is the honest
 ceiling for a hands-free assistant. It is why `sovereign` exists: the answer
 to approvals being inconvenient is to need fewer of them, not to make the ones
 that remain easier to forge.
*/
/** Affirmatives, negations, and the words that turn a question into a request. */
const AFFIRM = /\b(?:approve[ds]?|approving|confirm(?:ed)?|authorise[d]?|authorize[d]?|yes|go\s+ahead|do\s+it|send\s+it)\b/i;
const NEGATE = /\b(?:don'?t|do\s+not|never|cancel(?:led)?|denie[ds]?|deny|refuse[d]?|reject(?:ed)?|hold\s+off|not)\b/i;
const REFUSE = /\b(?:denie[ds]?|deny|refuse[d]?|reject(?:ed)?|no\s+to)\b/i;
/**
 * The id as a person says it.
 *
 * Speech-to-text renders `A-7F3K` as "A-7F3K", "a 7 f 3 k", "A7F3K" or
 * "A. 7 F 3 K" depending on the engine and the day. Each character is allowed
 * up to two separators after it, and the `A-` prefix is optional because Nick
 * drops it about half the time.
 */
function spokenIdPattern(id) {
    const body = id.replace(/^A-/, "");
    const loose = body.split("").join("[\\s.,-]{0,2}");
    return new RegExp(`(?:\\bA[\\s.,-]{0,2})?${loose}\\b`, "i");
}
/**
 * Cut machine-authored context out of a turn before reading it for a decision.
 *
 * `trusted_user` is minted by `hydrateFromTranscript` from any `role: "user"`
 * line in the session log, and the Swift app and the remote bridge both inject
 * their own context that way. Across the real session history nearly five
 * hundred such turns begin with a machine prefix — the app's factual-state
 * block, Talk Mode instructions, mission briefings, and the transport's own
 * briefing, which literally opens by saying it is not from Nick.
 *
 * That does not make the trust boundary wrong: those turns genuinely come from
 * the harness rather than from the model, which is what `trusted_user` means.
 * It does mean the class is wider than "Nick's own words", and an approval is
 * one of the few places where the difference matters. So the blocks announce
 * themselves and are removed here.
 *
 * The transport's briefing ends with an explicit marker — everything before
 * "Nick's message follows" is the transport talking — so that one is exact
 * rather than heuristic.
 */
export function stripMachineContext(text) {
    const marker = text.lastIndexOf("--- Nick's message follows ---");
    const afterBriefing = marker >= 0 ? text.slice(marker + 30) : text;
    /*
     BLOCKS, not lines. A machine context block is a header followed by INDENTED
     content, and filtering line-by-line dropped only the header — the first
     version of this passed the briefing test and failed on the app's state
     block, whose second line is `  pending: ...` with no prefix of its own.
     So a header opens a block and an indented line continues it; the first line
     at column zero ends it, which is exactly how both emitters format them.
    */
    const HEADER = /^\s*(?:\[(?:orion-|Orion app context|ORION)|Talk Mode active|You are ORION running an autonomous mission|This is a non-mutating internal validation)/i;
    const kept = [];
    let inBlock = false;
    for (const line of afterBriefing.split("\n")) {
        if (HEADER.test(line)) {
            inBlock = true;
            continue;
        }
        if (inBlock) {
            // Indented, or blank, keeps the block open. Anything at column zero is
            // a person talking again.
            if (line.trim() === "" || /^\s/.test(line))
                continue;
            inBlock = false;
        }
        kept.push(line);
    }
    return kept.join("\n");
}
/** The clause one occurrence of an id sits in, with the id taken out first. */
function clauseAround(text, found) {
    const MARK = "\u0000ID\u0000";
    const index = found.index ?? text.indexOf(found[0]);
    const marked = text.slice(0, index) + MARK + text.slice(index + found[0].length);
    return (marked
        .split(/[.!?;\n]|,\s*(?=and\b|then\b|also\b|but\b)/)
        .find((part) => part.includes(MARK)) ?? "");
}
/** Does THIS occurrence sit in a clause that decides something? */
function isDecisive(text, match) {
    const clause = clauseAround(text, match);
    return REFUSE.test(clause) || (AFFIRM.test(clause) && !NEGATE.test(clause));
}
/**
 * What Nick's own words decided, if anything.
 *
 * Deliberately silent rather than clever when a turn is ambiguous. "Should I
 * approve A-7F3K?" and "don't approve A-7F3K yet" both return nothing, and the
 * model then has to ask -- which costs one turn and is the right answer, where
 * guessing costs a message that cannot be unsent.
 *
 * @param userText concatenated `trusted_user` instruction inputs. Passing
 *   anything else here -- page text, a file, a message Orion read -- would
 *   hand the approval to whoever wrote it.
 */
export function decisionsInUserTurn(userText, tickets) {
    const text = stripMachineContext(String(userText ?? ""));
    if (text.trim().length === 0)
        return [];
    const decisions = [];
    for (const ticket of tickets) {
        /*
         EVERY occurrence, not the first.
    
         An oblivious review on 2026-09-04 found that `orion-remote`'s own briefing
         — which opens "Context from the transport, not from Nick" — contains the
         line `He can also just say it in an ordinary message -- "yes, approve
         A-7F3K" --` as an INSTRUCTION about how approvals work. It arrives inside
         the same turn as Nick's message. That turn returned no decision, but only
         because `exec` matched the FIRST occurrence of the id, which happened to
         sit in a non-affirmative clause. Reorder the briefing and it self-approves.
         The guard was match ordering, not a boundary.
    
         Two fixes, and each is sufficient alone: the briefing is stripped above,
         and every occurrence is examined here rather than whichever came first.
        */
        const pattern = new RegExp(spokenIdPattern(ticket.id).source, "gi");
        const occurrences = [...text.matchAll(pattern)];
        if (occurrences.length === 0)
            continue;
        const found = occurrences.find((match) => isDecisive(text, match)) ?? occurrences[0];
        /*
         Only the clause the id is in, and the id is taken OUT before splitting.
    
         "Cancel the alarm, and approve A-7F3K" is two instructions and only the
         second is an approval, so the sentence is cut at clause boundaries and
         just the containing clause is read. The subtlety, which cost one failing
         test: a transcriber writes the id as "A. 7 F 3 K", so splitting on `.`
         first tore the id in half and left a clause with no verb in it. Replacing
         the match with a punctuation-free marker before splitting means the id
         cannot be a boundary.
        */
        const clause = clauseAround(text, found);
        if (REFUSE.test(clause)) {
            decisions.push({ id: ticket.id, decision: "denied" });
            continue;
        }
        // An affirmative must be present AND unnegated. Absence of both is a
        // mention, not a decision: "what does A-7F3K do" changes nothing.
        if (AFFIRM.test(clause) && !NEGATE.test(clause)) {
            decisions.push({ id: ticket.id, decision: "approved" });
        }
    }
    return decisions;
}
/**
 * Apply what the turn said. Returns what it acted on, for the run record.
 *
 * `grantedBy` says `user-turn` rather than naming a channel, because this code
 * genuinely does not know which one it was -- and the claim it can make
 * honestly is the one that matters: these words came from the harness, not
 * from the model.
 */
export async function applyUserTurnDecisions(paths, userText, now = new Date()) {
    const decisions = decisionsInUserTurn(userText, readTickets(paths, now));
    for (const decision of decisions) {
        if (decision.decision === "approved")
            await grant(paths, decision.id, "user-turn", now);
        else
            await deny(paths, decision.id, now);
    }
    return decisions;
}
