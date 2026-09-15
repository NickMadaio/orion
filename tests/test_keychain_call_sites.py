"""The Keychain call sites are pinned, because one day they all have to change.

Nick deferred the Apple Developer Program to the end of the program on
2026-09-01. What that leaves behind is an obligation: when a Team ID finally
exists, moving to the data-protection Keychain must be a small edit rather than
an archaeology expedition.

Today that is true, and this test is what keeps it true. The whole app touches
the Keychain in exactly TWO places:

  · `Connections.swift`'s `enum SecretStore` -- connector credentials, service
    `com.nickmadaio.orion.connections`, read AND written. Already a proper
    chokepoint with `set`/`get`/`clear` and an off-main-thread snapshot.
  · `VoiceProviders.valueFromKeychain` -- read-only, and a DIFFERENT service and
    account convention (`service=<item>`, `account=openclaw`) because it reads
    the items the Phase 0 migration created. Genuinely separate, not an accident.

Four `SecItem*` calls total. Adding `kSecUseDataProtectionKeychain` means
touching four query dictionaries in two files.

So the risk is not the migration; it is a THIRD call site appearing quietly
between now and then, at which point "two small edits" silently becomes
"however many there are". This test fails when that happens, and names the file.

It pins the CONTENTS -- which files, which functions -- rather than a count.
`TodaySection.allCases.count == 8` passed after two members were swapped out;
a count cannot tell you the members are the ones you meant.

It also asserts a POSITIVE: the known call sites must still be there. A test
that only forbids new ones passes just as happily when someone deletes the
Keychain entirely and starts writing credentials to a plist.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SOURCES = REPO / "native" / "Orion" / "Sources"

# Any Keychain item API. Deliberately the whole family rather than the two verbs
# in use today: a new call site is just as interesting if it arrives as
# SecItemUpdate.
SEC_ITEM = re.compile(r"\bSecItem(?:Add|CopyMatching|Delete|Update)\s*\(")

# file -> the calls expected in it, by the enclosing declaration.
EXPECTED: dict[str, set[str]] = {
    "Orion/Connections.swift": {"SecItemDelete", "SecItemAdd", "SecItemCopyMatching"},
    "Orion/VoiceProviders.swift": {"SecItemCopyMatching"},
}


def _swift_sources() -> list[Path]:
    """Every Swift file under Sources, recursively.

    Recursively because SwiftPM compiles subdirectories: a guard that only lists
    a directory misses anything parked one level down, which is exactly how a
    deferred feature stayed public, callable and green in MobileCore.
    """
    return sorted(SOURCES.rglob("*.swift"))


def _calls_in(path: Path) -> set[str]:
    # Read as bytes and decode explicitly. `(try? String(contentsOf:)) ?? ""` is
    # recorded in AGENTS.md as making a grep pass on any file it cannot read;
    # the Python equivalent is a bare try/except that turns an unreadable file
    # into "no findings". An unreadable source here should raise.
    text = path.read_bytes().decode("utf-8")
    return {match.group(0)[: -len("(")].strip() for match in SEC_ITEM.finditer(text)}


class KeychainCallSitesArePinned(unittest.TestCase):
    def setUp(self) -> None:
        if not SOURCES.is_dir():
            self.skipTest(f"{SOURCES} is not present in this checkout")

    def test_the_app_touches_the_keychain_in_exactly_the_known_places(self) -> None:
        found: dict[str, set[str]] = {}
        for path in _swift_sources():
            calls = _calls_in(path)
            if calls:
                found[str(path.relative_to(SOURCES))] = calls

        self.assertEqual(
            found,
            EXPECTED,
            "The Keychain call sites moved.\n\n"
            "If you ADDED one: the Apple Developer Program migration has to touch it too. "
            "Prefer routing through Connections.swift's `SecretStore` so there stays one "
            "place that decides which Keychain is in use, then update EXPECTED here.\n\n"
            "If you REMOVED one: update EXPECTED, and check that credentials did not "
            "quietly stop being stored in the Keychain at all.\n\n"
            "Context: docs/planning/v2/ROADMAP_AMENDMENTS.json -> "
            "programCorrection.foundationForTheAppleDeveloperProgram",
        )

    def test_nothing_claims_the_data_protection_keychain_yet(self) -> None:
        """It is measured to be unavailable while the app is self-signed.

        AGENTS.md, measured 2026-08-18: claiming `keychain-access-groups`
        without a real team identity gets the process SIGKILLed by the kernel,
        and without that entitlement every data-protection call returns -34018.
        So this appearing before there is a Team ID is a bug that would present
        as the app dying on launch, which is worth catching here rather than
        there.
        """
        offenders = [
            str(path.relative_to(SOURCES))
            for path in _swift_sources()
            if "kSecUseDataProtectionKeychain" in path.read_bytes().decode("utf-8")
        ]
        self.assertEqual(
            offenders,
            [],
            "kSecUseDataProtectionKeychain requires an Apple Developer Team ID. "
            "While the app is self-signed it returns -34018, and claiming the "
            "matching entitlement gets the process SIGKILLed. Remove this until "
            "the Team ID exists, then delete this test in the same change.",
        )

    def test_the_entitlements_file_does_not_claim_keychain_access_groups(self) -> None:
        entitlements = REPO / "native" / "Orion" / "Resources" / "Orion.entitlements"
        if not entitlements.is_file():
            self.skipTest("no entitlements file in this checkout")
        self.assertNotIn(
            "keychain-access-groups",
            entitlements.read_bytes().decode("utf-8"),
            "Claiming keychain-access-groups while self-signed gets the process "
            "SIGKILLed by the kernel on launch. Measured 2026-08-18.",
        )


if __name__ == "__main__":
    unittest.main()
