import { describe, expect, it } from "vitest";
import { GOVERNED_SELF_DEVELOPMENT_ENABLED, GovernedSelfDevelopmentDisabledError, SelfChangeForbiddenError, assertDiffAllowed, assertGovernedSelfDevelopmentEnabled, forbiddenSelfChangeSurface, } from "./self-development-authority.js";
describe("default state: OFF", () => {
    it("GOVERNED_SELF_DEVELOPMENT_ENABLED is false", () => {
        expect(GOVERNED_SELF_DEVELOPMENT_ENABLED).toBe(false);
    });
    it("assertGovernedSelfDevelopmentEnabled refuses unconditionally", () => {
        expect(() => assertGovernedSelfDevelopmentEnabled()).toThrow(GovernedSelfDevelopmentDisabledError);
        expect(() => assertGovernedSelfDevelopmentEnabled()).toThrow(/disabled/);
    });
});
describe("assertDiffAllowed: the forbidden self-change surfaces", () => {
    it.each([
        ["openclaw-plugins/orion-control/src/approvals.ts", "approval verifier"],
        ["openclaw-plugins/orion-control/src/validator.ts", "policy evaluator"],
        ["openclaw-plugins/orion-control/src/catalog.ts", "policy evaluator"],
        ["openclaw-plugins/orion-control/src/permissions.ts", "permission-profile ladder"],
        ["openclaw-plugins/orion-control/src/strictness.ts", "friction ladder"],
        ["openclaw-plugins/orion-control/src/ledger.ts", "audit ledger"],
        ["openclaw-plugins/orion-control/src/provenance.ts", "hash chain"],
        ["openclaw-plugins/orion-control/src/selfrepair.ts", "classification tables"],
        ["openclaw-plugins/orion-control/src/self-development-authority.ts", "deny-list may not remove itself"],
        ["orion/security/profiles.py", "sandbox and secret-handling"],
        ["orion/security/risk.py", "sandbox and secret-handling"],
        ["scripts/orion-lock", "LOCK ORION"],
        ["scripts/orion-repair", "repair engine"],
        ["scripts/orion-forge", "Swift self-modification"],
        ["scripts/orion-approve", "how a person says yes"],
        ["scripts/orion-mode", "how a person sets how much"],
        ["scripts/orion-sign-setup", "signing setup"],
        ["scripts/orion-keys", "Keychain material"],
        ["native/Orion/Sources/Orion/UpdateController.swift", "update signing"],
        ["native/Orion/make_app_bundle.sh", "update signing"],
        ["backend/connectors/broker.py", "privileged broker"],
    ])("REFUSES a diff touching %s", (candidate, expectedReasonFragment) => {
        expect(() => assertDiffAllowed([candidate])).toThrow(SelfChangeForbiddenError);
        try {
            assertDiffAllowed([candidate]);
            throw new Error("should have thrown");
        }
        catch (err) {
            expect(err).toBeInstanceOf(SelfChangeForbiddenError);
            const message = err.message;
            expect(message).toContain(candidate);
            expect(message.toLowerCase()).toContain(expectedReasonFragment.toLowerCase());
            expect(message).toContain("regardless of strictness mode");
        }
    });
    it("refuses on the FIRST forbidden path in a multi-file diff, even when it is not first in the list", () => {
        expect(() => assertDiffAllowed([
            "openclaw-plugins/orion-control/src/some-new-feature.ts",
            "openclaw-plugins/orion-control/src/approvals.ts",
            "openclaw-plugins/orion-control/src/another-new-file.ts",
        ])).toThrow(SelfChangeForbiddenError);
    });
    it("ALLOWS an ordinary new plugin source file", () => {
        expect(() => assertDiffAllowed(["openclaw-plugins/orion-control/src/some-new-feature.ts"])).not.toThrow();
        expect(forbiddenSelfChangeSurface("openclaw-plugins/orion-control/src/some-new-feature.ts")).toBeUndefined();
    });
    it("ALLOWS a file that merely shares a basename with a forbidden one elsewhere in the tree", () => {
        expect(() => assertDiffAllowed(["notes/approvals.ts"])).not.toThrow();
        expect(() => assertDiffAllowed(["docs/orion-lock.md"])).not.toThrow();
    });
    it("REFUSES a path that traverses above the repository root, and absolute or ~-relative paths", () => {
        // Four "../" segments climb past all three of
        // "openclaw-plugins/orion-control/src" and one level further, so the
        // normalized path starts with ".." -- genuinely outside the repo, not
        // merely relocated within it.
        expect(() => assertDiffAllowed([
            "openclaw-plugins/orion-control/src/../../../../etc/passwd",
        ])).toThrow(/must not traverse/);
        expect(() => assertDiffAllowed(["/etc/passwd"])).toThrow(/relative to the repository root/);
        expect(() => assertDiffAllowed(["~/Desktop/ORION/orion/security/risk.py"])).toThrow(/relative to the repository root/);
    });
    it("a relative path with '..' that STAYS inside the repo is judged on where it actually lands", () => {
        // Two "../" segments from "openclaw-plugins/orion-control/src" resolve to
        // "openclaw-plugins/orion/security/risk.py" -- a path that merely LOOKS
        // like it is reaching for the real orion/security/risk.py but is not it,
        // and is not on the deny-list. The function judges the resolved
        // destination, not the presence of ".." in the input.
        expect(() => assertDiffAllowed(["openclaw-plugins/orion-control/src/../../orion/security/risk.py"])).not.toThrow();
    });
});
describe("SelfChangeForbiddenError", () => {
    it("carries the offending path and the surface's own reason as fields, not just in the message", () => {
        try {
            assertDiffAllowed(["orion/security/profiles.py"]);
            throw new Error("should have thrown");
        }
        catch (err) {
            const typed = err;
            expect(typed.path).toBe("orion/security/profiles.py");
            expect(typed.surfaceReason.length).toBeGreaterThan(0);
        }
    });
});
