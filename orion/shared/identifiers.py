"""Validated opaque identifiers for ORION v2 boundary records."""

from __future__ import annotations

import re


_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")
_SYMBOL = re.compile(r"^[A-Za-z][A-Za-z0-9._:-]{0,63}$")


class Identifier(str):
    """An opaque, log-safe identifier with no embedded whitespace."""

    def __new__(cls, value: object) -> "Identifier":
        if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
            raise ValueError("identifier has an invalid format")
        return str.__new__(cls, value)


class Symbol(str):
    """A bounded protocol name such as a source, capability, or policy version."""

    def __new__(cls, value: object) -> "Symbol":
        if not isinstance(value, str) or not _SYMBOL.fullmatch(value):
            raise ValueError("symbol has an invalid format")
        return str.__new__(cls, value)
