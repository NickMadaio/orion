"""An inbox for acting, not for reading — and the memory a correction may not become.

The manifest's hardest sentence in this phase is the last one: "do not
automatically turn correction history into unrestricted model memory."

The line it draws is worth stating precisely, because both halves are
reasonable-sounding and only one is allowed. "This person has moved four
newsletters to low priority" is a fact about how they want their inbox sorted.
"Nick doesn't care about marketing" is a durable claim about a person, derived by
inference from external content — and Phases 3 and 18 already refuse that
exactly.

So a correction produces a `PreferenceSignal` that is **scoped** to inbox
classification, carries `ORION_INFERRED` once aggregated (which Phase 18's
`NEVER_DURABLE` refuses under all four grounds), and has no method that yields
memory and no field a sentence could live in.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from enum import Enum

from backend.gmail.messages import ID_PATTERN, MessageRefused
from orion.core.context.domains import Provenance


class Classification(str, Enum):
    """The manifest's nine, plus one that is not a failure.

    `UNCLASSIFIED` is the same decision Phase 20 made about capture kinds: a
    classifier that always produces an answer produces a wrong one for anything
    unusual, and ambiguity has to be representable before it can be resolved.
    It is deliberately not surfaceable.
    """

    NEEDS_REPLY = "needs_reply"
    WAITING_ON = "waiting_on"
    IMPORTANT = "important"
    FYI = "fyi"
    RECEIPT = "receipt"
    NEWSLETTER = "newsletter"
    TRAVEL = "travel"
    CALENDAR = "calendar"
    LOW_PRIORITY = "low_priority"
    UNCLASSIFIED = "unclassified"


#: The manifest's nine, as a set, so "we added a tenth by accident" is a test
#: failure rather than a thing somebody notices later.
MANIFEST_CLASSES = frozenset(
    {
        Classification.NEEDS_REPLY,
        Classification.WAITING_ON,
        Classification.IMPORTANT,
        Classification.FYI,
        Classification.RECEIPT,
        Classification.NEWSLETTER,
        Classification.TRAVEL,
        Classification.CALENDAR,
        Classification.LOW_PRIORITY,
    }
)

#: Which classes reach the Today screen. A table rather than a rule each caller
#: re-derives -- and complete, so a class added later cannot silently default
#: one way. `actionable()` refuses a class with no entry.
ACTIONABLE: Mapping[Classification, bool] = {
    Classification.NEEDS_REPLY: True,
    Classification.WAITING_ON: True,
    Classification.IMPORTANT: True,
    Classification.TRAVEL: True,
    Classification.CALENDAR: True,
    Classification.FYI: False,
    Classification.RECEIPT: False,
    Classification.NEWSLETTER: False,
    Classification.LOW_PRIORITY: False,
    #: Not surfaced. An item ORION could not classify is a question for ORION,
    #: not an action for the person.
    Classification.UNCLASSIFIED: False,
}


class InboxRefused(ValueError):
    """The inbox declined, and the reason names the rule."""


def actionable(classification: Classification) -> bool:
    """Whether this class reaches Today. Refuses a class nobody decided about."""

    classification = Classification(classification)
    if classification not in ACTIONABLE:
        raise InboxRefused(
            f"{classification.value} has no actionability entry; a class added without "
            f"one would silently default"
        )
    return ACTIONABLE[classification]


class Source(str, Enum):
    """Who said so. The whole of the correction feature rests on this distinction."""

    ORION = "orion"
    USER = "user"


@dataclass(frozen=True, slots=True)
class ClassifiedItem:
    """One message's place in the inbox. No text, by construction.

    Phase 26 refused to store message content and recorded this as its
    follow-up. The same field walk applies here: a `subject` or `snippet` on this
    class would be the mirror arriving through a different door.
    """

    message_id: str
    classification: Classification
    classified_at: datetime
    source: Source = Source.ORION
    confidence: float = 0.0
    #: Set when a person overrode ORION. Kept so a later reader can tell an
    #: answer from a guess -- the same reason Phase 20 records `resolvedBy`.
    corrected_from: Classification | None = None

    def __post_init__(self) -> None:
        set_ = object.__setattr__
        if not isinstance(self.message_id, str) or not ID_PATTERN.match(self.message_id):
            raise MessageRefused("message_id must be a provider id")
        set_(self, "classification", Classification(self.classification))
        set_(self, "source", Source(self.source))
        if not isinstance(self.classified_at, datetime) or self.classified_at.tzinfo is None:
            raise InboxRefused("classified_at must be an aware datetime")
        set_(self, "classified_at", self.classified_at.astimezone(timezone.utc))
        if not isinstance(self.confidence, (int, float)) or isinstance(self.confidence, bool):
            raise InboxRefused("confidence is a number between 0 and 1")
        if not 0.0 <= float(self.confidence) <= 1.0:
            raise InboxRefused("confidence is a number between 0 and 1")
        set_(self, "confidence", float(self.confidence))
        if self.corrected_from is not None:
            set_(self, "corrected_from", Classification(self.corrected_from))
            if self.source is not Source.USER:
                raise InboxRefused("only a person corrects a classification")
            if self.corrected_from is self.classification:
                raise InboxRefused("a correction changes the classification")
        if self.source is Source.USER and self.confidence != 1.0:
            # A person saying so is not a probability.
            raise InboxRefused("a classification a person made is certain")

    @property
    def is_actionable(self) -> bool:
        return actionable(self.classification)


def correct(
    item: ClassifiedItem, to: Classification, *, at: datetime
) -> tuple[ClassifiedItem, "Correction"]:
    """A person overriding ORION, and the signal that produces.

    Returns both, because a correction that updates the item without recording
    why is a correction ORION makes again next week.
    """

    to = Classification(to)
    if to is item.classification:
        raise InboxRefused("that is already its classification")
    if to is Classification.UNCLASSIFIED:
        # A person can say what something is. "I don't know" is ORION's state,
        # not an instruction, and accepting it would let a correction erase a
        # working classification.
        raise InboxRefused("a person corrects to a class, not to unclassified")
    corrected = replace(
        item,
        classification=to,
        classified_at=at.astimezone(timezone.utc),
        source=Source.USER,
        confidence=1.0,
        corrected_from=item.classification,
    )
    return corrected, Correction(
        message_id=item.message_id,
        was=item.classification,
        became=to,
        at=corrected.classified_at,
    )


@dataclass(frozen=True, slots=True)
class Correction:
    """One override. Ids and classes only -- there is nowhere to put a sentence."""

    message_id: str
    was: Classification
    became: Classification
    at: datetime

    def __post_init__(self) -> None:
        set_ = object.__setattr__
        set_(self, "was", Classification(self.was))
        set_(self, "became", Classification(self.became))
        if self.was is self.became:
            raise InboxRefused("a correction changes something")


#: How many corrections of one shape are kept. Bounded on purpose: an unbounded
#: correction log is a record of everything a person has ever disagreed with,
#: which is the "unrestricted memory" the manifest is warning about wearing a
#: different name. Ten is enough to see a pattern and not enough to be a history.
SIGNAL_HISTORY_LIMIT = 10

#: The one scope a preference signal applies to. Not a free string: a scope a
#: caller can invent is a scope that will eventually say "everything".
INBOX_SCOPE = "gmail.inbox.classification"


class PreferenceRefused(InboxRefused):
    """Something tried to turn a preference into a claim about a person."""


@dataclass(frozen=True, slots=True)
class PreferenceSignal:
    """What ORION may learn from corrections, and the shape that bounds it.

    Every field is a class, a count or a scope constant. There is no text, no
    summary and no `to_memory()`. Its provenance is `ORION_INFERRED`, which
    Phase 18's `NEVER_DURABLE` refuses to promote under any grounds -- so the
    manifest's rule is inherited from the phase that already made it rather
    than restated here where it could drift.
    """

    was: Classification
    became: Classification
    observations: int
    scope: str = INBOX_SCOPE
    provenance: Provenance = Provenance.ORION_INFERRED

    def __post_init__(self) -> None:
        set_ = object.__setattr__
        set_(self, "was", Classification(self.was))
        set_(self, "became", Classification(self.became))
        # Compared AND pinned. `provenance` was pinned and `scope` was only
        # compared, so a str subclass whose __eq__ returns True passed the check
        # and was then stored verbatim -- a reader of `.scope` saw
        # "everything". Re-setting to the constant means what is stored is the
        # constant, whatever compared equal to it.
        if str.__ne__(str(self.scope), INBOX_SCOPE):
            raise PreferenceRefused(
                f"a correction signal applies to {INBOX_SCOPE} and nothing else; "
                f"a preference that can name its own scope will eventually name all of them"
            )
        set_(self, "scope", INBOX_SCOPE)
        if Provenance(self.provenance) is not Provenance.ORION_INFERRED:
            raise PreferenceRefused(
                "an aggregate over corrections is something ORION concluded, and "
                "ORION_INFERRED is what Phase 18 refuses to make permanent"
            )
        set_(self, "provenance", Provenance.ORION_INFERRED)
        if type(self.observations) is not int or self.observations < 1:
            raise PreferenceRefused("observations start at one")
        if self.observations > SIGNAL_HISTORY_LIMIT:
            # `signals_from` saturates; a signal built directly did not, so the
            # bound was a property of one function rather than of the type.
            raise PreferenceRefused(
                f"a signal counts at most {SIGNAL_HISTORY_LIMIT} observations; "
                f"beyond that it is a history of everything a person disagreed with"
            )

    def applies_to(self, scope: object) -> bool:
        """Whether this signal has anything to say about `scope`. Almost always no.

        This used to be `scope == INBOX_SCOPE` -- a constant function of its
        argument that never read `self.scope` at all, so the field it exists to
        enforce had no effect on the answer, and a hostile argument whose
        `__eq__` returns True made it say yes to anything. The gate's own
        follow-up says a future classifier must consume signals through this
        method; it would have been reading a method that ignored the scope.
        """

        return (
            str.__eq__(str(self.scope), INBOX_SCOPE)
            and isinstance(scope, str)
            and str.__eq__(str(scope), INBOX_SCOPE)
        )


def signals_from(corrections: Sequence[Correction]) -> tuple[PreferenceSignal, ...]:
    """Aggregate corrections into scoped preferences.

    Grouped by (was, became) and capped at SIGNAL_HISTORY_LIMIT. The cap is the
    point: a signal says "this happens", not "here is everything you have ever
    disagreed with".
    """

    counts: dict[tuple[Classification, Classification], int] = {}
    for correction in corrections:
        if not isinstance(correction, Correction):
            raise PreferenceRefused("signals are aggregated from corrections")
        key = (correction.was, correction.became)
        counts[key] = min(counts.get(key, 0) + 1, SIGNAL_HISTORY_LIMIT)
    return tuple(
        PreferenceSignal(was=was, became=became, observations=count)
        for (was, became), count in sorted(
            counts.items(), key=lambda item: (item[0][0].value, item[0][1].value)
        )
    )


#: How many inbox items reach Today. Phase 19 caps its screen at twelve across
#: all sections; mail must not be allowed to fill it.
TODAY_LIMIT = 5


def for_today(items: Iterable[ClassifiedItem], *, limit: int = TODAY_LIMIT) -> tuple[ClassifiedItem, ...]:
    """The actionable items, newest first, capped.

    Phase 19 built a screen that refuses to become a dashboard. An inbox that
    can push twelve items onto it turns it into one, so mail gets five.
    """

    if type(limit) is not int or limit < 1:
        raise InboxRefused("a limit is a positive whole number")
    actionable_items = [item for item in items if item.is_actionable]
    actionable_items.sort(key=lambda item: (-item.classified_at.timestamp(), item.message_id))
    return tuple(actionable_items[:limit])
