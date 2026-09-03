import { randomBytes, randomInt } from "node:crypto";
import { hostname } from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
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
    await rename(path.join(paths.grants, `${match.grant.id}.json`), path.join(paths.used, `${match.grant.id}-${stamp}.json`)).catch(() => undefined);
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
    await writeFile(path.join(paths.grants, `${ticket.id}.json`), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600 }).catch(() => undefined);
    return { ok: true, ticket };
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
