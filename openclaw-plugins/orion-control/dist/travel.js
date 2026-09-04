import os from "node:os";
import path from "node:path";
/*
 PHASE 78 — travel, built on things that already exist.

 The manifest names the foundations and they are all here: Calendar, Gmail,
 timezone support. What is missing is the object in the middle — a TRIP that a
 flight confirmation, a hotel booking and a calendar block all point at.

 ## Detection proposes; it never decides

 A confirmation email is untrusted text. Anyone can send Nick a message that
 looks exactly like a flight confirmation, so nothing detected here becomes a
 trip on its own: `detect` returns CANDIDATES with what it matched and why, and
 a trip is only created by an explicit act. That is the same rule the whole
 system runs on — a target that appeared only in content Orion read cannot
 authorize anything — applied to a feature whose entire input is content Orion
 read.

 The confidence vocabulary from Phase 64 is used literally rather than as
 decoration. A parsed flight number is `inferred`: a regex matched, and nothing
 checked it against an airline. Saying "you fly at 6am" about an inferred
 booking is exactly the failure Phase 64 exists to prevent.

 ## Nothing here books anything

 The manifest's one hard line is "require approval before creating/modifying
 important bookings", and the honest way to satisfy it is that there is no
 booking capability at all — no action in this tier reaches a network endpoint
 that could reserve anything, and Phase 76's deferral check watches for one
 arriving. A trip object is a note about a booking somebody else made.

 ## Timezone is reported, never applied

 `orion-timezone set` changes what every other part of the system believes the
 time is. A travel feature that quietly moved it would make every calendar
 read, every reminder and every quiet-hours calculation silently wrong on
 exactly the days Nick is least able to notice. So the brief SAYS the shift and
 gives him the command; it does not run it.
*/
export const TRIP_STORE = path.join(os.homedir(), ".openclaw/orion-controlled/trips.json");
export const EMPTY_TRIPS = { version: 1, trips: [] };
const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/*
 What a confirmation looks like. Narrow on purpose.

 A loose pattern here does not produce a slightly-wrong trip; it produces a
 trip out of a marketing email, and a travel brief nobody trusts. So each of
 these requires a STRUCTURED token — an airline code plus digits, a
 confirmation-code shape, a check-in line — rather than a keyword.
*/
const FLIGHT_RE = /\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b(?=[^\n]{0,80}(?:depart|arriv|flight|gate|terminal|confirmation))/i;
const AIRPORT_PAIR_RE = /\b([A-Z]{3})\s*(?:->|→|—|-|to)\s*([A-Z]{3})\b/;
const CONFIRMATION_RE = /\b(?:confirmation|booking|record locator|reference)\s*(?:code|number|#|:)?\s*([A-Z0-9]{5,8})\b/i;
const HOTEL_RE = /\b(?:check[- ]?in|checkin)\b[^\n]{0,60}?(\d{4}-\d{2}-\d{2}|\d{1,2}\s+\w{3,9}\s+\d{4})/i;
const DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;
/** A date in any of the shapes a confirmation writes, or null. */
export function parseLooseDate(text) {
    const iso = DATE_RE.exec(text);
    if (iso)
        return iso[1];
    const written = /\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/.exec(text);
    if (!written)
        return null;
    const month = [
        "jan", "feb", "mar", "apr", "may", "jun",
        "jul", "aug", "sep", "oct", "nov", "dec",
    ].indexOf(written[2].slice(0, 3).toLowerCase());
    if (month < 0)
        return null;
    return `${written[3]}-${String(month + 1).padStart(2, "0")}-${String(Number(written[1])).padStart(2, "0")}`;
}
/**
 * Legs found in a block of message text.
 *
 * Returns CANDIDATES. Nothing here writes, and nothing here decides that a
 * message is genuine — every leg carries the line it came from so a person can
 * look, and every leg is `inferred` because a regex matched and nothing checked
 * it against an airline.
 */
export function detectLegs(messageText) {
    const legs = [];
    const lines = String(messageText ?? "").split("\n").map((line) => line.trim());
    for (const line of lines) {
        if (line.length === 0 || line.length > 400)
            continue;
        const flight = FLIGHT_RE.exec(line);
        if (flight) {
            const pair = AIRPORT_PAIR_RE.exec(line);
            legs.push({
                kind: "flight",
                reference: `${flight[1].toUpperCase()}${flight[2]}`,
                ...(pair ? { from: pair[1], to: pair[2] } : {}),
                ...(parseLooseDate(line) ? { on: parseLooseDate(line) } : {}),
                confidence: "inferred",
                evidence: line.slice(0, 160),
            });
            continue;
        }
        const hotel = HOTEL_RE.exec(line);
        if (hotel) {
            const confirmation = CONFIRMATION_RE.exec(line);
            legs.push({
                kind: "hotel",
                reference: confirmation?.[1]?.toUpperCase() ?? "check-in",
                ...(parseLooseDate(hotel[1]) ? { on: parseLooseDate(hotel[1]) } : {}),
                confidence: "inferred",
                evidence: line.slice(0, 160),
            });
        }
    }
    // Deduplicated on reference AND date: the same confirmation arrives three
    // times — booked, reminder, check-in — and three copies of one flight is a
    // brief nobody reads.
    const seen = new Set();
    return legs.filter((leg) => {
        const key = `${leg.kind}:${leg.reference}:${leg.on ?? ""}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
export function validateTrip(value) {
    const issues = [];
    const trip = (value ?? {});
    if (typeof trip.id !== "string" || !ID_RE.test(trip.id)) {
        issues.push("id must be lower-case letters, digits and hyphens, 2-40 characters");
    }
    if (typeof trip.name !== "string" || trip.name.trim().length < 2) {
        issues.push("name must say where this trip is to");
    }
    for (const field of ["startsOn", "endsOn"]) {
        if (typeof trip[field] !== "string" || !ISO_DATE.test(trip[field])) {
            issues.push(`${field} is required as YYYY-MM-DD`);
        }
    }
    if (typeof trip.startsOn === "string" &&
        typeof trip.endsOn === "string" &&
        ISO_DATE.test(trip.startsOn) &&
        ISO_DATE.test(trip.endsOn) &&
        trip.endsOn < trip.startsOn) {
        issues.push("endsOn is before startsOn");
    }
    if (trip.destinationZone !== undefined) {
        // Shape only. Whether the zone EXISTS is answered below by asking the
        // runtime, because a hand-maintained list of IANA zones is a list that is
        // wrong the next time one is renamed.
        if (typeof trip.destinationZone !== "string" || !/^[A-Za-z]+\/[A-Za-z_+-]+/.test(trip.destinationZone)) {
            issues.push("destinationZone must be an IANA zone like Europe/London");
        }
        else if (!zoneExists(trip.destinationZone)) {
            issues.push(`'${trip.destinationZone}' is not a timezone this machine knows`);
        }
    }
    return issues;
}
/** Ask the runtime rather than a list. Wrong zones throw; that is the check. */
export function zoneExists(zone) {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: zone });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * The hour difference at a given instant, destination minus home.
 *
 * Computed at the trip's START rather than now, because that is when it
 * applies and because the two can differ: fly from New York to London in late
 * October and the gap is five hours on the way out and four on the way back.
 * A single "it is +5 there" is wrong for half the trip.
 */
export function zoneShiftHours(home, destination, at) {
    if (!zoneExists(home) || !zoneExists(destination))
        return null;
    const read = (zone) => {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: zone,
            hour12: false,
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit",
        }).formatToParts(at);
        const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
        return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    };
    return Math.round((read(destination) - read(home)) / 3_600_000);
}
/**
 * The travel brief.
 *
 * Says what is known, says what is merely inferred, and says the timezone shift
 * WITHOUT applying it. Every leg carries its evidence line, because a brief
 * assembled from untrusted email that cannot be checked is a brief that has to
 * be trusted.
 */
export function renderBrief(trip, options) {
    const now = options.now ?? new Date();
    const out = [];
    out.push(`${trip.name} — ${trip.startsOn} to ${trip.endsOn}`);
    const days = Math.round((Date.parse(`${trip.startsOn}T00:00:00`) - Date.parse(`${now.toLocaleDateString("en-CA")}T00:00:00`)) / 86_400_000);
    out.push(days > 0 ? `${days} day(s) away` : days === 0 ? "starts today" : `started ${-days} day(s) ago`);
    out.push("");
    if (trip.legs.length === 0) {
        out.push("No flights or bookings on file for this trip.");
    }
    else {
        out.push("Bookings, as read out of your mail:");
        for (const leg of trip.legs) {
            const where = leg.from && leg.to ? ` ${leg.from} → ${leg.to}` : "";
            const when = leg.on ? ` on ${leg.on}` : "";
            out.push(`  ${leg.kind} ${leg.reference}${where}${when}`);
            // Verbatim, and labelled. A paraphrased piece of evidence is a claim
            // about evidence.
            out.push(`    ${leg.confidence}: matched "${leg.evidence}"`);
        }
        out.push("");
        out.push("Every line above is INFERRED — a pattern matched an email and nothing " +
            "checked it against an airline. Confirm anything you are relying on.");
    }
    if (trip.destinationZone) {
        const shift = zoneShiftHours(options.homeZone, trip.destinationZone, new Date(`${trip.startsOn}T12:00:00Z`));
        out.push("");
        if (shift === null) {
            out.push(`Timezone: could not compare ${options.homeZone} with ${trip.destinationZone}.`);
        }
        else {
            const direction = shift === 0 ? "the same time as" : shift > 0 ? `${shift}h ahead of` : `${-shift}h behind`;
            out.push(`Timezone: ${trip.destinationZone} is ${direction} ${options.homeZone} when you arrive.`);
            out.push("I have NOT changed anything. Moving the system clock changes what every " +
                "reminder, quiet-hours rule and calendar read believes, so it is yours to run:");
            out.push(`    orion-timezone set ${trip.destinationZone} --place "${trip.name}"`);
        }
    }
    return out.join("\n");
}
