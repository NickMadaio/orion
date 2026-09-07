/*
 PERSONALITIES -- Main, Vent, Coach, Research, Creative.

 Nick's own framing, from a conversation this file did not have access to but
 whose shape survives the grep: five conversational postures, requested
 because Orion should not sound the same way while planning a sprint review
 and while venting about one. The rule this file exists to make impossible to
 violate, verbatim from the job:

     Unrestricted speech; restricted capabilities.

 A personality may change TONE, MEMORY SELECTION, PLANNING STYLE and which
 already-declared MODEL ROLE it leans toward (Research may lean on `reasoning`
 more; Coach might not need it at all). It may never change what Orion is
 ALLOWED to do. Research asking for wider sources still means Research asking
 -- it does not mean a new tool becomes reachable, a filesystem root widens, or
 a message goes out that would otherwise have needed sign-off.

 HOW THIS IS ENFORCED, AND WHY IT IS NOT A RUNTIME CHECK

 The tempting version of this file has a `PermissionProfile` or `StrictnessMode`
 field on `PersonalityProfile` and a runtime rule that says "personalities may
 not set this above what the session already has". That is a real answer, but
 the wrong shape for it: it means a widening EXISTS as a value the field can
 hold, and the guarantee lives in whoever remembers to call the check.

 `PersonalityProfile` below has no such field. There is nowhere for a
 capability tier, a permission profile, a strictness mode, an exec-allowlist
 entry, or a filesystem root to be written, so a definition that tries to grant
 one is not "rejected", it does not compile -- TypeScript's excess-property
 check on an object literal assigned to this type turns an attempt into
 error TS2353, which personalities.test.ts proves by feeding the compiler an
 actual literal that tries it (mutation-tested: delete the offending field from
 the fixture and the same test asserts the compiler is happy). "Passed by
 absence" is the strongest version of this guarantee this repo's own convention
 asks for, and it is the one used here.

 `parsePersonalityProfile` below is the second layer, for the case the type
 system cannot reach: a personality definition arriving as untyed JSON (a
 config file on disk, a value that crossed a process boundary) is `unknown` to
 TypeScript no matter what the interface says. It is a strict ALLOWLIST of
 field names, not a denylist of authority-shaped ones -- a denylist has to
 predict every spelling of "let me widen this" and is wrong the first time
 someone adds a field a denylist did not anticipate. An allowlist only ever
 admits what it already knows is safe.

 `composeConversationConfiguration` is the third layer: the function that
 actually combines a personality with a session's real authority never merges
 the two objects. It returns the authority object BY REFERENCE, untouched, so
 there is no code path inside it that could read a personality field and use it
 to widen anything -- proven in personalities.test.ts by identity comparison,
 and mutation-tested by literally trying to make it merge and watching the
 assertion fail.
*/
export const PERSONALITY_IDS = [
    "main",
    "vent",
    "coach",
    "research",
    "creative",
];
export const PERSONALITIES = {
    main: {
        id: "main",
        label: "Main",
        tone: "Orion as he is day to day: steady, plain, no performance either way.",
        memoryLean: "focused",
        planningStyle: "direct",
        modelRoleLean: "reasoning",
        sourceBreadth: "normal",
    },
    vent: {
        id: "vent",
        label: "Vent",
        tone: "Listens first. Does not solve a problem nobody asked to have solved yet.",
        memoryLean: "minimal",
        planningStyle: "reflective",
        modelRoleLean: "reasoning",
        sourceBreadth: "narrow",
    },
    coach: {
        id: "coach",
        label: "Coach",
        tone: "More directive: names the next action instead of listing options.",
        memoryLean: "focused",
        planningStyle: "direct",
        modelRoleLean: "reasoning",
        sourceBreadth: "normal",
    },
    research: {
        id: "research",
        label: "Research",
        tone: "Slower and more thorough; shows its sources rather than its confidence.",
        memoryLean: "broad",
        planningStyle: "exploratory",
        modelRoleLean: "reasoning",
        sourceBreadth: "wide",
    },
    creative: {
        id: "creative",
        label: "Creative",
        tone: "Generates options freely; volume over certainty, and says so.",
        memoryLean: "broad",
        planningStyle: "brainstorm",
        modelRoleLean: "local",
        sourceBreadth: "wide",
    },
};
const ALLOWED_PERSONALITY_FIELDS = new Set([
    "id",
    "label",
    "tone",
    "memoryLean",
    "planningStyle",
    "modelRoleLean",
    "sourceBreadth",
]);
/**
 * Raised only for a field this system will never define, on purpose. Its
 * message is the one guarantee callers get to depend on: unrestricted speech,
 * restricted capabilities.
 */
export class PersonalityAuthorityViolation extends Error {
    constructor(field) {
        super(`personality profile carries an unrecognised field "${field}" -- ` +
            "personalities may only change tone, memory selection, planning " +
            "style and which declared model role they lean toward. Unrestricted " +
            "speech; restricted capabilities.");
        this.name = "PersonalityAuthorityViolation";
    }
}
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
/**
 * Validate an untyped candidate against the allowlist above, then against
 * each field's own vocabulary. Refuses ANY key this module has not already
 * named -- including a real one spelled differently, and including anything
 * that looks like authority. There is no fallback path that admits an
 * unrecognised key "for now".
 */
export function parsePersonalityProfile(candidate) {
    if (!isRecord(candidate)) {
        throw new Error("a personality profile must be a JSON object");
    }
    for (const key of Object.keys(candidate)) {
        if (!ALLOWED_PERSONALITY_FIELDS.has(key)) {
            throw new PersonalityAuthorityViolation(key);
        }
    }
    const { id, label, tone, memoryLean, planningStyle, modelRoleLean, sourceBreadth } = candidate;
    if (typeof id !== "string" || !PERSONALITY_IDS.includes(id)) {
        throw new Error(`id must be one of: ${PERSONALITY_IDS.join(", ")}`);
    }
    if (typeof label !== "string" || label.length === 0 || label.length > 40) {
        throw new Error("label must be a non-empty string under 40 characters");
    }
    if (typeof tone !== "string" || tone.length === 0 || tone.length > 400) {
        throw new Error("tone must be a non-empty string under 400 characters");
    }
    if (!["broad", "focused", "minimal"].includes(memoryLean)) {
        throw new Error("memoryLean must be one of: broad, focused, minimal");
    }
    if (!["direct", "exploratory", "reflective", "brainstorm"].includes(planningStyle)) {
        throw new Error("planningStyle must be one of: direct, exploratory, reflective, brainstorm");
    }
    if (!["reasoning", "local", "fast", "coder"].includes(modelRoleLean)) {
        throw new Error("modelRoleLean must be one of: reasoning, local, fast, coder");
    }
    if (!["narrow", "normal", "wide"].includes(sourceBreadth)) {
        throw new Error("sourceBreadth must be one of: narrow, normal, wide");
    }
    return {
        id: id,
        label,
        tone,
        memoryLean: memoryLean,
        planningStyle: planningStyle,
        modelRoleLean: modelRoleLean,
        sourceBreadth: sourceBreadth,
    };
}
/**
 * Combine a personality with a session's authority. This is the whole
 * mechanism, and it is deliberately not a merge: `authority` passes through
 * BY REFERENCE. There is no line in this function that reads a
 * `PersonalityProfile` field and writes it into the authority half, because
 * `PersonalityProfile` has no field that could mean "widen this" in the first
 * place. personalities.test.ts asserts referential equality on the returned
 * `authority` for exactly this reason -- a future edit that started merging
 * fields in would break that assertion before it shipped.
 */
export function composeConversationConfiguration(personality, authority) {
    return { personality, authority };
}
