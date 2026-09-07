"""Which of the manifest's six risk levels a capability sits at.

Derived, never declared. A request may state what it believes its risk is, and
the engine uses that for exactly one thing: denying on mismatch. Anything else
would let the caller -- which may be the model -- choose its own level.

## What this deliberately does NOT read

`Capability.side_effects` looks like the obvious input and is not usable here.
Phase 4 derived it from `execution.kind`, which is coarser than the action, so
it is wrong in BOTH directions on the live registry:

- `self_plugin_read`, `self_config_list`, `self_repair_status` and
  `reminder_list` are reads that declare `writes_files`, because they share the
  `self_repair` and `reminder` kinds with the actions that do write;
- `calendar_event_add` and `calendar_event_remove` write to Apple Calendar and
  declare only `reads_user_data`, for the same reason in reverse.

A risk classifier built on that would over-gate four reads and under-gate three
calendar mutations. So risk is derived from the three facts the Phase 4 drift
check actually proves against the live catalog every run: the capability tier,
the severity word, and reversibility. The side-effect correction is recorded as
a Phase 4 follow-up rather than quietly worked around.
"""

from __future__ import annotations

from orion.core.tools.registry import Capability
from orion.security.vocabulary import RiskLevel, highest


#: The reach of the gate an action sits behind. Tier is the live permission
#: concept -- it is what `permissions.ts` grants -- so it is the honest base for
#: "how far can this reach", and it is drift-checked against the catalog.
TIER_REACH = {
    # Observation.
    "simulation": RiskLevel.R0,
    "ambient_info": RiskLevel.R0,
    "desktop_read": RiskLevel.R0,
    "home_read": RiskLevel.R0,
    "messages_read": RiskLevel.R0,
    # Local, reversible.
    "app_control": RiskLevel.R1,
    "media_control": RiskLevel.R1,
    "test_workspace": RiskLevel.R1,
    "scratch_workspace": RiskLevel.R1,
    "desktop_test_workspace": RiskLevel.R1,
    "desktop_modify": RiskLevel.R1,
    "desktop_direct_write": RiskLevel.R1,
    "scratch_direct_write": RiskLevel.R1,
    "reminders": RiskLevel.R1,
    "health_tracking": RiskLevel.R1,
    "self_tuning": RiskLevel.R1,
    # Leaves the machine, but can be undone.
    "browser_control": RiskLevel.R2,
    "calendar": RiskLevel.R2,
    # Reaches another person.
    "messages_send": RiskLevel.R3,
    # Destroys or moves the user's data.
    "file_mutate": RiskLevel.R4,
    # Changes what ORION itself is or may do.
    "self_modification": RiskLevel.R5,
    "self_plugin": RiskLevel.R5,
    "self_scripts": RiskLevel.R5,
    "self_config": RiskLevel.R5,
    # Added 2026-09-04 for the five tiers phases 51-78 introduced. The engine
    # refused to classify them rather than defaulting, which is how the drift
    # was found — a default here would have silently graded a tier nobody had
    # thought about.
    #
    # Local, reversible: these write one JSON file Orion owns and reach nothing
    # the user did not already have.
    "waiting_on": RiskLevel.R1,
    "automation": RiskLevel.R1,
    "travel": RiskLevel.R1,
    # Atlas exposes owner-scoped note operations and no arbitrary file path.
    # Reads demote normally; creates and updates are local data changes.
    "atlas_notes": RiskLevel.R1,
    # A prep card only reads — mail, the brain, the calendar — and writes
    # nothing at all. It sits with the other observation tiers.
    "prep": RiskLevel.R0,
    # R5, alongside the self_* family rather than with the filesystem tiers.
    # `tests_run`, `build_run` and `package_install` execute code out of a
    # repository and `git_pull` can bring in a hook, so the reach is "whatever
    # that repository does" — which is the same reach self_scripts has. Grading
    # it by the paths involved would put it at R1 and be wrong about the four
    # operations that are not reads.
    "dev_operations": RiskLevel.R5,
    # PHASE 53/54. Observation: the accessibility tree of the focused window,
    # or a screenshot fallback. Read-only and reaches nothing the user did not
    # already have on screen -- graded with the other reads, not R1, because
    # unlike a file listing it can surface content the user did not choose to
    # write down (whatever happens to be visible), which the severity floor
    # below (`risk: "medium"` on both actions) already accounts for.
    "computer_observe": RiskLevel.R0,
    # PHASE 53/55. Control: click, type, key. Everything a person at the
    # keyboard could do, which is the same reach `self_modification` and
    # `dev_operations` have -- "whatever the frontmost app does" is an
    # unbounded blast radius by construction, not a filesystem operation, and
    # must not arrive as a side effect of widening a filesystem tier.
    "computer_control": RiskLevel.R5,
}

#: The catalog's severity word as a floor. Severity and reach are different
#: axes, so this raises the level and never lowers it.
SEVERITY_FLOOR = {
    "low": RiskLevel.R0,
    "medium": RiskLevel.R1,
    "high": RiskLevel.R3,
    "critical": RiskLevel.R5,
}

#: Tiers the "a read is a read" demotion may never touch. The demotion exists so
#: `self_config_list` is not privileged for listing a key; applied to a tier that
#: moves or sends things it would quietly lower a destructive capability, and the
#: parity check would not notice, because being LESS strict than the tier while
#: still matching the live gate is exactly what it permits.
NEVER_DEMOTED_TIERS = frozenset(
    {
        "file_mutate",
        "messages_send",
        "self_modification",
        "dev_operations",
        # PHASE 53/55. screen_click/screen_type/screen_key: everything a
        # person at the keyboard could do. `computer_control` is R5 in
        # TIER_REACH above; this is the second, independent place that has
        # to say so, because TIER_REACH sets the FLOOR a demotion may not
        # cross and this set decides whether the "a read is a read" demotion
        # runs at all. Omitting it here would not lower the level on its
        # own -- `classify` only demotes `risk == "low" and reversible`,
        # and every computer_control action declares `risk: "critical"` and
        # `reversible: False` in the live TypeScript catalog, so the
        # demotion's own guard already refuses to fire. It is listed
        # anyway, for the same reason `messages_send` is listed despite the
        # identical argument applying to it: this set is read by a person
        # deciding what "never demoted" means, and a tier that reaches this
        # far belongs on the list on its own terms, not on the strength of
        # a second field happening to protect it today.
        "computer_control",
    }
)

#: Tiers whose actions touch nothing the user owns. An irreversible action here
#: is a closed browser tab, not lost data, so the destructive rule below does
#: not apply to them.
NON_DATA_TIERS = frozenset(
    {"simulation", "ambient_info", "app_control", "browser_control", "media_control"}
)

#: A capability tier the reach table does not know is not given a default. A
#: default would silently classify a tier added later -- exactly the case where
#: a human should have to decide.
class UnknownTier(ValueError):
    """A capability sits behind a tier with no recorded reach."""


def tier_of(capability: Capability) -> str:
    """The live capability tier for a registry entry.

    `resource_scope` carries the tier name verbatim -- Phase 4 wrote the tier
    into that field, and the drift check proves it still matches the catalog.
    """

    return capability.resource_scope


def classify(capability: Capability) -> RiskLevel:
    """The risk level for a live capability."""

    tier = tier_of(capability)
    if tier not in TIER_REACH:
        raise UnknownTier(f"{capability.action} sits behind unrecorded tier {tier!r}")
    if capability.risk not in SEVERITY_FLOOR:
        raise ValueError(f"{capability.action} has unrecorded severity {capability.risk!r}")

    level = highest((TIER_REACH[tier], SEVERITY_FLOOR[capability.risk]))

    # A read is a read whatever gate it sits behind. `self_config_list` is tiered
    # with the authority writes it shares a surface with, and listing Orion's
    # own settings is still a read -- without this, the tier alone would make it
    # privileged and demand a signature to list a config key.
    if capability.risk == "low" and capability.reversible and tier not in NEVER_DEMOTED_TIERS:
        level = RiskLevel.R1 if level.rank > 1 else level

    # Something the user owns, changed with no way back, is destructive. This is
    # the rule that catches `desktop_file_write_explicit` overwriting a file with
    # no undo while the catalog rates it `medium` and asks for no approval.
    if not capability.reversible and tier not in NON_DATA_TIERS and level.rank >= 1:
        level = highest((level, RiskLevel.R4))

    # A simulated action reaches nothing at all. `email_send` is rated `high` and
    # irreversible because it is described as if it were real; it writes a line
    # to a transcript. Applied last so no earlier rule can raise it back.
    if tier == "simulation":
        level = RiskLevel.R0

    return level


def mismatch(capability: Capability, declared: RiskLevel | None) -> bool:
    """Whether a caller's declared risk disagrees with the derived one.

    `validator.ts` already denies on `risk_mismatch`; this is the same check in
    the same place a decision is made, so a caller that guesses low to skip a
    gate is refused rather than obeyed.
    """

    return declared is not None and declared is not classify(capability)
