"""Which devices exist, who owns them, and how far they are trusted.

Trust is looked up here, never read off a request. A device that states its own
trust level has not been checked -- it has filled in a field. That distinction
is the whole reason this module exists separately from `request.py`.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Iterable, Mapping

from orion.shared.identifiers import Identifier, Symbol
from orion.security.vocabulary import DeviceTrust


@dataclass(frozen=True, slots=True)
class Device:
    device_id: Identifier
    owner_id: Identifier
    trust: DeviceTrust
    platform: Symbol
    signing_key_id: Identifier | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "device_id", Identifier(self.device_id))
        object.__setattr__(self, "owner_id", Identifier(self.owner_id))
        object.__setattr__(self, "trust", DeviceTrust(self.trust))
        object.__setattr__(self, "platform", Symbol(self.platform))
        if self.signing_key_id is not None:
            object.__setattr__(self, "signing_key_id", Identifier(self.signing_key_id))
        if self.trust is DeviceTrust.PAIRED and self.signing_key_id is None:
            # A paired device with no key cannot sign anything, so every R4/R5
            # action from it would be denied at the signature gate with a
            # confusing reason. Refusing the record makes the mistake visible
            # where it is made.
            raise ValueError("a paired device must carry a signing key id")


class DeviceDirectory:
    """The devices this installation knows about.

    An unregistered device is UNKNOWN rather than an error: "we have never seen
    this device" is a real answer a policy rule should get to act on, and
    raising instead would let a lookup failure become an exception path that
    somebody catches and turns into a default.
    """

    def __init__(self, devices: Iterable[Device] = ()) -> None:
        registry: dict[str, Device] = {}
        for device in devices:
            if device.device_id in registry:
                raise ValueError(f"device {device.device_id} registered twice")
            registry[str(device.device_id)] = device
        self._devices: Mapping[str, Device] = MappingProxyType(registry)

    def __len__(self) -> int:
        return len(self._devices)

    def get(self, device_id: str) -> Device | None:
        return self._devices.get(str(device_id))

    def trust_of(self, device_id: str) -> DeviceTrust:
        device = self.get(device_id)
        return device.trust if device is not None else DeviceTrust.UNKNOWN

    def owns(self, user_id: str, device_id: str) -> bool:
        """Whether this user owns this device, as recorded on the server side."""

        device = self.get(device_id)
        return device is not None and str(device.owner_id) == str(user_id)

    def revoke(self, device_id: str) -> "DeviceDirectory":
        """A new directory with one device revoked.

        Returns a new directory rather than mutating: a decision that was made
        against a directory should stay explicable afterwards, which it is not
        if the directory it was made against has since changed underneath it.
        """

        device = self.get(device_id)
        if device is None:
            raise ValueError(f"unknown device: {device_id}")
        replaced = Device(
            device_id=device.device_id,
            owner_id=device.owner_id,
            trust=DeviceTrust.REVOKED,
            platform=device.platform,
            signing_key_id=device.signing_key_id,
        )
        return DeviceDirectory(
            [replaced if other.device_id == device.device_id else other
             for other in self._devices.values()]
        )
