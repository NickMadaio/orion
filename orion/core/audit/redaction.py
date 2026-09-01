"""The central redaction middleware.

Recursive over any JSON value, and it reports what it struck **by rule name and
field path, never by content**. A redaction report that quotes the secret it
found is a second copy of the secret, written somewhere nobody is watching.

This is called from the `AuditEvent` constructor rather than offered to writers,
because middleware a writer has to remember to call is middleware that will be
forgotten exactly once, silently.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Sequence

from orion.core.audit.patterns import (
    CREDENTIAL_SHAPES,
    DROPPED,
    PLACEHOLDER,
    field_is_prompt,
    field_is_sensitive,
)


#: An audit detail nested deeper than this is a bug in the producer, not a
#: record worth keeping. Bounded so a hostile or looping structure cannot make
#: the audit path the most expensive thing in the request.
MAX_DEPTH = 12

#: Long values are truncated rather than stored whole. An audit record is
#: evidence that something happened, not a copy of the thing.
MAX_STRING = 4096

TRUNCATION = "…[truncated]"


@dataclass(frozen=True, slots=True)
class Redaction:
    """One thing that was struck, and where. Deliberately without the value."""

    path: str
    rule: str


@dataclass(frozen=True, slots=True)
class Redacted:
    value: object
    redactions: tuple[Redaction, ...]

    @property
    def clean(self) -> bool:
        return not self.redactions

    @property
    def rules(self) -> tuple[str, ...]:
        return tuple(sorted({item.rule for item in self.redactions}))


def redact_text(text: str, path: str = "") -> tuple[str, tuple[Redaction, ...]]:
    """Strike every credential shape in a string."""

    if not isinstance(text, str):
        raise ValueError("redact_text takes a string")
    found: list[Redaction] = []
    result = text
    for rule, pattern in CREDENTIAL_SHAPES.items():
        replaced, count = pattern.subn(PLACEHOLDER.format(rule=rule), result)
        if count:
            found.append(Redaction(path=path or "<value>", rule=rule))
            result = replaced
    if len(result) > MAX_STRING:
        result = result[: MAX_STRING - len(TRUNCATION)] + TRUNCATION
        found.append(Redaction(path=path or "<value>", rule="truncated"))
    return result, tuple(found)


def redact(value: object, *, path: str = "", keep_prompts: bool = False) -> Redacted:
    """Redact any JSON value, returning it alongside what was struck.

    `keep_prompts` is the manifest's secure-debug exemption and nothing more: it
    keeps prompt-shaped FIELDS, and the credential shapes inside them are struck
    either way. The exemption is for the prompt, not for what somebody pasted
    into it.
    """

    found: list[Redaction] = []
    result = _walk(value, path, keep_prompts, found, depth=0)
    return Redacted(value=result, redactions=tuple(found))


def _walk(
    value: object,
    path: str,
    keep_prompts: bool,
    found: list[Redaction],
    *,
    depth: int,
) -> object:
    if depth > MAX_DEPTH:
        found.append(Redaction(path=path or "<root>", rule="too_deeply_nested"))
        return PLACEHOLDER.format(rule="too_deeply_nested")

    if isinstance(value, Mapping):
        redacted: dict[str, object] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError("audit detail keys must be strings")
            child = f"{path}.{key}" if path else key
            if field_is_prompt(key) and not keep_prompts:
                found.append(Redaction(path=child, rule="prompt_dropped"))
                redacted[key] = DROPPED
                continue
            if field_is_sensitive(key):
                # The whole subtree goes, not just the scalar. A dict under
                # `credentials` is not made safe by walking into it.
                found.append(Redaction(path=child, rule="sensitive_field"))
                redacted[key] = PLACEHOLDER.format(rule="sensitive_field")
                continue
            redacted[key] = _walk(item, child, keep_prompts, found, depth=depth + 1)
        return redacted

    if isinstance(value, str):
        text, struck = redact_text(value, path)
        found.extend(struck)
        return text

    if isinstance(value, (list, tuple)):
        return [
            _walk(item, f"{path}[{index}]", keep_prompts, found, depth=depth + 1)
            for index, item in enumerate(value)
        ]

    if value is None or isinstance(value, (bool, int, float)):
        return value

    # Anything else -- a datetime, an object, a set -- is not JSON and must not
    # reach a record by having its repr taken. repr() is how an object's private
    # attributes end up in a log.
    raise ValueError(f"audit values must be JSON; {path or '<root>'} is {type(value).__name__}")


def redacted_summary(redactions: Sequence[Redaction]) -> tuple[str, ...]:
    """The rule names that fired, deduplicated and sorted, for a record field."""

    return tuple(sorted({item.rule for item in redactions}))
