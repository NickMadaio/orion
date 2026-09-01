"""The context firewall: assemble a bundle, and refuse what does not belong.

Every bundle passes through here. The builder's job is not to find context --
callers supply candidates -- but to decide which of them an inference in a given
domain is allowed to see, and to write down what it refused.

That last part matters more than it looks. Least-context was already real in
ORION before this phase: selective recall, cache-ttl pruning, one-result
defaults. It was just invisible, and a decision nobody records cannot be audited
later or argued with now.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

from orion.core.context.domains import Domain, Provenance
from orion.core.context.policy import (
    CredentialLeak,
    admits,
    allowance_reason,
    denial_reason,
)
from orion.core.context.ports import (
    MAX_CONTEXT_CHARACTERS,
    MAX_CONTEXT_ENTRIES,
    ContextBundle,
    ContextEntry,
)
from orion.shared.identifiers import Identifier


@dataclass(frozen=True, slots=True)
class Exclusion:
    """One candidate that did not make it, and why."""

    source: str
    domain: Domain
    reason: str


@dataclass(frozen=True, slots=True)
class BuiltContext:
    """A bundle plus the record of what was left out of it."""

    bundle: ContextBundle
    exclusions: tuple[Exclusion, ...]
    task_domain: Domain

    @property
    def admitted_domains(self) -> frozenset[Domain]:
        return frozenset(entry.domain for entry in self.bundle.entries)


def build(
    correlation_id: str | Identifier,
    task_domain: Domain | str,
    candidates: Sequence[ContextEntry],
    *,
    max_entries: int = MAX_CONTEXT_ENTRIES,
    max_characters: int = MAX_CONTEXT_CHARACTERS,
) -> BuiltContext:
    """Build the bundle an inference in `task_domain` is allowed to see.

    Candidates are considered in the order given; a caller that wants its most
    relevant context to survive the budget should offer it first. Nothing here
    reorders by relevance, because guessing at relevance is the caller's job and
    doing it silently here would make the budget cut unpredictable.

    Raises CredentialLeak if a credential-domain item is offered. Every other
    refusal is recorded and the build continues -- one inadmissible item should
    not deny an inference all of its context, but a credential reaching this
    function at all means something upstream is broken badly enough to stop.
    """

    domain = Domain(task_domain)
    admitted: list[ContextEntry] = []
    excluded: list[Exclusion] = []
    characters = 0

    for candidate in candidates:
        if not isinstance(candidate, ContextEntry):
            raise ValueError("context candidates must be ContextEntry values")

        if candidate.domain is Domain.CREDENTIALS:
            raise CredentialLeak(
                f"{candidate.source} offered credential-domain context to a "
                f"{domain.value} bundle"
            )

        if not admits(domain, candidate.domain):
            excluded.append(
                Exclusion(
                    source=str(candidate.source),
                    domain=candidate.domain,
                    reason=denial_reason(domain, candidate.domain) or "denied",
                )
            )
            continue

        if len(admitted) >= max_entries:
            excluded.append(
                Exclusion(str(candidate.source), candidate.domain,
                          f"bundle already holds {max_entries} entries")
            )
            continue

        if characters + len(candidate.text) > max_characters:
            excluded.append(
                Exclusion(str(candidate.source), candidate.domain,
                          f"would exceed the {max_characters} character budget")
            )
            continue

        admitted.append(candidate)
        characters += len(candidate.text)

    return BuiltContext(
        bundle=ContextBundle(correlation_id=Identifier(correlation_id), entries=tuple(admitted)),
        exclusions=tuple(excluded),
        task_domain=domain,
    )


def explain(built: BuiltContext) -> list[str]:
    """Human-readable lines describing the decision, for an audit record.

    Cross-domain admissions are explained too, not just refusals. A reviewer
    asking why an email task could see contacts deserves the recorded reason
    rather than having to go read the matrix.
    """

    lines: list[str] = []
    for entry in built.bundle.entries:
        if entry.domain is built.task_domain or entry.domain is Domain.GENERAL:
            continue
        reason = allowance_reason(built.task_domain, entry.domain) or "allowed by policy"
        lines.append(
            f"admitted {entry.domain.value} from {entry.source}: {reason}"
        )
    for exclusion in built.exclusions:
        lines.append(f"excluded {exclusion.domain.value} from {exclusion.source}: {exclusion.reason}")
    return lines


def untrusted_entries(built: BuiltContext) -> tuple[ContextEntry, ...]:
    """Everything in the bundle that arrived from outside.

    A caller rendering a prompt needs to know which parts are data rather than
    instruction. Making it ask is better than a flag buried on each entry that
    is easy to not read.
    """

    return tuple(
        entry
        for entry in built.bundle.entries
        if entry.provenance is Provenance.EXTERNAL_UNTRUSTED
    )
