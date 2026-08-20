"""Immutable JSON values for records crossing ORION v2 boundaries."""

from __future__ import annotations

import math
from types import MappingProxyType
from typing import Mapping


def freeze_json(value: object) -> object:
    """Validate and recursively freeze a JSON-compatible value."""

    if value is None or isinstance(value, (bool, str, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("JSON numbers must be finite")
        return value
    if isinstance(value, Mapping):
        if not all(isinstance(key, str) for key in value):
            raise ValueError("JSON object keys must be strings")
        return MappingProxyType(
            {key: freeze_json(item) for key, item in value.items()}
        )
    if isinstance(value, (list, tuple)):
        return tuple(freeze_json(item) for item in value)
    raise ValueError("value is not representable as JSON")


def freeze_json_object(value: object, field: str) -> Mapping[str, object]:
    """Validate and recursively freeze a JSON object boundary field."""

    if not isinstance(value, Mapping):
        raise ValueError(f"{field} must be a JSON object")
    frozen = freeze_json(value)
    assert isinstance(frozen, Mapping)
    return frozen


def thaw_json(value: object) -> object:
    """Return ordinary dictionaries/lists suitable for JSON encoding."""

    if isinstance(value, Mapping):
        return {key: thaw_json(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [thaw_json(item) for item in value]
    return value
