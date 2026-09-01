"""The ORION cloud backend: a modular monolith, declared before it is built.

Deliberately a top-level package rather than `orion.backend` or `orion.cloud`.
The first would put a server inside the package that runs on Nick's Mac; the
second collides with the legacy `orion/cloud.py`, which Phase 1 already recorded
as a name it would not take.
"""

__all__: tuple[str, ...] = ()
