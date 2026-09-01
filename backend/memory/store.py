"""Writing, recalling, editing and deleting memory.

Recall goes through Phase 3's domain matrix rather than around it: a memory is
context, and the rule that health context must not reach an email task does not
stop applying because the health fact was remembered rather than read.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable

from backend.memory.classes import MemoryClass, rules_for
from backend.memory.durability import NEVER_DURABLE, Evidence, PromotionRefused, check
from backend.memory.records import MemoryItem
from orion.core.context.domains import Domain, Provenance
from orion.core.context.policy import admits
from orion.shared.result import Sensitivity


class MemoryStore:
    def __init__(self) -> None:
        self._items: dict[tuple[str, str], MemoryItem] = {}

    # -- writing -----------------------------------------------------------

    def remember(
        self,
        *,
        memory_id: str,
        user_id: str,
        memory_class: MemoryClass,
        domain: Domain,
        body: str,
        source: str,
        provenance: Provenance,
        sensitivity: Sensitivity,
        now: datetime,
        evidence: Evidence | None = None,
        confidence: float = 1.0,
        expires_at: datetime | None = None,
        user_editable: bool | None = None,
    ) -> MemoryItem:
        """Store a memory, refusing anything that has not earned its class."""

        memory_class = MemoryClass(memory_class)
        rules = rules_for(memory_class)

        if rules.durable and Provenance(provenance) in NEVER_DURABLE:
            # EPISODIC is durable WITHOUT grounds, so the whole block below was
            # skipped for it. MemoryItem enforces this on the type as well; this
            # is here so the store's callers get the store's exception.
            raise PromotionRefused(
                f"{Provenance(provenance).value} can never become durable memory, "
                f"whatever grounds are claimed"
            )
        if rules.requires_grounds:
            if evidence is None:
                raise PromotionRefused(
                    f"{memory_class.value} memory requires grounds; the manifest names four"
                )
            check(evidence)
            if evidence.provenance is not Provenance(provenance):
                # The grounds are checked against the item's own provenance, not
                # against a provenance the caller supplied alongside them.
                raise PromotionRefused("the evidence describes a different provenance")

        lifetime = rules.default_lifetime
        resolved_expiry = expires_at
        if lifetime is not None:
            ceiling = now + lifetime
            # The class lifetime is a CEILING, not a default the caller may
            # exceed. Working memory is documented as "never durable"; without
            # this, remember(WORKING, expires_at=+10y) was accepted and recalled
            # five years later, which makes the documentation a wish.
            resolved_expiry = ceiling if resolved_expiry is None else min(resolved_expiry, ceiling)

        item = MemoryItem(
            memory_id=memory_id,
            user_id=user_id,
            memory_class=memory_class,
            domain=domain,
            body=body,
            source=source,
            provenance=provenance,
            confidence=confidence,
            sensitivity=sensitivity,
            created_at=now,
            updated_at=now,
            expires_at=resolved_expiry,
            user_editable=rules.user_editable_by_default if user_editable is None else user_editable,
            grounds=None if evidence is None else evidence.grounds.value,
            observations=1 if evidence is None else evidence.observations,
        )
        self._items[(user_id, memory_id)] = item
        return item

    # -- reading -----------------------------------------------------------

    def recall(
        self,
        user_id: str,
        *,
        task_domain: Domain,
        now: datetime,
        classes: Iterable[MemoryClass] | None = None,
    ) -> tuple[MemoryItem, ...]:
        """What a task in this domain may see. Owner-scoped and firewalled.

        A memory is context. The rule that health context must not reach an email
        task does not stop applying because the fact was remembered rather than
        read, so recall asks Phase 3 rather than reimplementing it.
        """

        # `if classes else` treated an EMPTY allowlist as "no filter given" and
        # returned every class -- a filter computed down to nothing admitted
        # everything, which is the wrong direction to fail in.
        wanted = (
            set(MemoryClass) if classes is None else {MemoryClass(item) for item in classes}
        )
        return tuple(
            item
            for (owner, _), item in sorted(self._items.items())
            if owner == user_id
            and item.memory_class in wanted
            and not item.expired_at(now)
            and admits(Domain(task_domain), item.domain)
        )

    def inspect(self, user_id: str, *, now: datetime) -> tuple[MemoryItem, ...]:
        """Everything ORION holds about this person, including what has expired.

        Deliberately unfiltered by domain: "let me see what you know about me" is
        a different question from "what may this task see", and answering it with
        a firewalled subset would be answering a question nobody asked.
        """

        return tuple(item for (owner, _), item in sorted(self._items.items()) if owner == user_id)

    def get(self, user_id: str, memory_id: str) -> MemoryItem:
        try:
            return self._items[(user_id, memory_id)]
        except KeyError:
            raise KeyError(f"no memory {memory_id}") from None

    # -- editing -----------------------------------------------------------

    def edit(self, user_id: str, memory_id: str, body: str, *, now: datetime) -> MemoryItem:
        edited = self.get(user_id, memory_id).edited(body, now=now)
        self._items[(user_id, memory_id)] = edited
        return edited

    def forget(self, user_id: str, memory_id: str) -> bool:
        """Delete. Available for every class, including the ones ORION values.

        The manifest says users may delete their memories. It does not say
        "unless the system thinks one is important", and a delete that argues
        back is not a delete.
        """

        return self._items.pop((user_id, memory_id), None) is not None

    def forget_all(self, user_id: str) -> int:
        keys = [key for key in self._items if key[0] == user_id]
        for key in keys:
            del self._items[key]
        return len(keys)

    # -- housekeeping ------------------------------------------------------

    def sweep(self, now: datetime) -> tuple[str, ...]:
        expired = [
            key for key, item in self._items.items() if item.expired_at(now)
        ]
        for key in expired:
            del self._items[key]
        return tuple(memory_id for _, memory_id in expired)

    def __len__(self) -> int:
        return len(self._items)
