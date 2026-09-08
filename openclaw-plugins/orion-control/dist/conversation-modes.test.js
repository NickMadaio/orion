import { describe, expect, it } from "vitest";
import { CONVERSATION_MODES, CONVERSATION_MODE_IDS, UnknownWorkspaceRootError, modeForConnectivity, resolveMode, } from "./conversation-modes.js";
import { routeConversation } from "./conversation-routing.js";
import { PERSONALITIES } from "./personalities.js";
const GRANTED = ["brain", "desktop", "scratch"];
describe("conversation modes: a branch may not plant a new root", () => {
    it("resolves a mode whose workspace root is already granted", () => {
        const { mode, personality } = resolveMode("project", GRANTED);
        expect(mode.workspaceRootId).toBe("brain");
        expect(personality.id).toBe("research");
    });
    it("REFUSES a mode naming a root the capability system does not grant", () => {
        expect(() => resolveMode("project", ["desktop"])).toThrow(UnknownWorkspaceRootError);
        expect(() => resolveMode("project", ["desktop"])).toThrow(/may not.*introduce one/s);
    });
    it("no mode can express a capability, tier, profile or strictness", () => {
        // Passed by absence, the same way personalities are: if one of these names
        // ever appears on a mode, this fails and the reviewer has to justify it.
        const forbidden = [
            "capability", "capabilityTier", "tier", "permissionProfile", "profile",
            "strictnessMode", "strictness", "allowlist", "approval", "root", "path",
        ];
        for (const id of CONVERSATION_MODE_IDS) {
            for (const key of Object.keys(CONVERSATION_MODES[id])) {
                expect(forbidden).not.toContain(key);
            }
        }
    });
    it("every mode names a personality that exists", () => {
        for (const id of CONVERSATION_MODE_IDS) {
            expect(PERSONALITIES[CONVERSATION_MODES[id].personality]).toBeDefined();
        }
    });
});
describe("connectivity drives the mode, and says so", () => {
    it("switches to offline when the network goes, with a reason a person would accept", () => {
        const r = modeForConnectivity("main", false);
        expect(r).toMatchObject({ id: "offline", changed: true });
        expect(r.reason).toContain("less sharp");
    });
    it("comes back out of offline when the network returns", () => {
        expect(modeForConnectivity("offline", true)).toMatchObject({ id: "main", changed: true });
    });
    it("does not thrash when nothing changed", () => {
        expect(modeForConnectivity("main", true).changed).toBe(false);
        expect(modeForConnectivity("offline", false).changed).toBe(false);
    });
    it("leaves Project mode alone while online — it is a choice, not a fallback", () => {
        expect(modeForConnectivity("project", true).changed).toBe(false);
    });
});
describe("routing: offline never reaches for a cloud role", () => {
    const conditions = { offline: true, urgency: "routine", unassignedRoles: [] };
    it("substitutes the deep local model for cloud reasoning when offline", () => {
        const d = routeConversation(PERSONALITIES.main, conditions);
        expect(d.role).toBe("local_deep");
        expect(d.reason).toContain("offline");
    });
    it("uses the fast local model when Nick is waiting, not the deep one", () => {
        const d = routeConversation(PERSONALITIES.main, { ...conditions, urgency: "time_sensitive" });
        expect(d.role).toBe("local");
        expect(d.reason).toContain("asked in the moment");
    });
    it("falls back and EXPLAINS when a role is declared but unassigned", () => {
        const d = routeConversation({ ...PERSONALITIES.main, modelRoleLean: "coder" }, { offline: false, urgency: "routine", unassignedRoles: ["coder"] });
        expect(d.role).toBe("reasoning");
        expect(d.reason).toContain("no model assigned");
        expect(d.reason).toContain("tone is unchanged");
    });
    it("online, an ordinary chat still goes to the cloud reasoner", () => {
        const d = routeConversation(PERSONALITIES.main, {
            offline: false, urgency: "routine", unassignedRoles: [],
        });
        expect(d.role).toBe("reasoning");
    });
});
