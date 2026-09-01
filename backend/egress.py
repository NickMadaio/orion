"""What the backend is allowed to fetch, which is almost nothing.

The manifest's invariant is "arbitrary internal URLs cannot be fetched through
SSRF". The way SSRF is usually prevented is a denylist of private ranges, and the
way that fails is a hostname that resolves to one, or an encoding nobody thought
of, or a redirect.

So this is **default deny**: a host that is not on an explicit allowlist is
refused, whatever it looks like. The private-range checks are then a second layer
for the case where an allowlisted name is pointed somewhere it should not be.

Two things this cannot do alone, both the caller's obligation and both stated
here rather than assumed:

- **redirects** must be re-checked hop by hop, because a permitted host can
  answer with a 302 to a forbidden one;
- **the resolved address** must be pinned by the HTTP client. This function sees
  a name; DNS decides what it means, and it can decide differently between the
  check and the connection.
"""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from typing import Iterable
from urllib.parse import urlsplit


ALLOWED_SCHEMES = frozenset({"https"})
ALLOWED_PORTS = frozenset({443})

#: Names that mean "this machine" or "this network", in the spellings that have
#: actually been used in the wild.
DENIED_HOSTS = frozenset(
    {
        "localhost",
        "metadata",
        "metadata.google.internal",
        "instance-data",
        "instance-data.ec2.internal",
        "kubernetes.default",
        "kubernetes.default.svc",
    }
)
DENIED_SUFFIXES = (".local", ".localhost", ".internal", ".home.arpa", ".svc", ".cluster.local")

#: Carrier-grade NAT. Not private under some definitions, not routable either.
CGNAT = ipaddress.ip_network("100.64.0.0/10")


class EgressRefused(ValueError):
    """The backend declined to fetch this URL."""


@dataclass(frozen=True, slots=True)
class Target:
    scheme: str
    host: str
    port: int
    path: str


def check(url: str, *, allowlist: Iterable[str] = ()) -> Target:
    """Return the target, or raise. Default deny: an empty allowlist fetches nothing."""

    if not isinstance(url, str) or not url:
        raise EgressRefused("no URL")
    parts = urlsplit(url.strip())
    scheme = parts.scheme.lower()
    if scheme not in ALLOWED_SCHEMES:
        raise EgressRefused(f"scheme {scheme or '(none)'} is not permitted")
    if parts.username or parts.password or "@" in (parts.netloc or ""):
        # Credentials in a URL end up in logs, and `https://api.example.com@evil`
        # is the oldest trick there is.
        raise EgressRefused("a URL may not carry credentials")
    # Checked on the RAW netloc, before `hostname` is read. `urlsplit().hostname`
    # lowercases, and Python folds U+212A KELVIN SIGN to ASCII "k" -- so a host
    # spelled with it arrives already looking like `hooks.slack.com` and matches
    # an allowlist entry for a domain it is not. By the time you can read
    # `hostname`, the evidence is gone.
    if not (parts.netloc or "").isascii():
        raise EgressRefused("a host must be ASCII; encode an international name as punycode")
    host = (parts.hostname or "").rstrip(".")
    if not host:
        raise EgressRefused("no host")
    try:
        port = parts.port
    except ValueError as error:
        raise EgressRefused("invalid port") from error
    if port == 0:
        # `parts.port or 443` silently rewrote an explicit :0 into the default.
        raise EgressRefused("port 0 is not a port")
    port = port or 443
    if port not in ALLOWED_PORTS:
        raise EgressRefused(f"port {port} is not permitted")

    _refuse_local_names(host)
    _refuse_local_addresses(host)

    permitted = {item.lower().rstrip(".") for item in allowlist}
    if host not in permitted:
        raise EgressRefused(f"{host} is not on the egress allowlist")

    return Target(scheme=scheme, host=host, port=port, path=parts.path or "/")


def _refuse_local_names(host: str) -> None:
    if host in DENIED_HOSTS or any(host.endswith(suffix) for suffix in DENIED_SUFFIXES):
        raise EgressRefused(f"{host} names an internal host")
    if "." not in host and not _is_address(host):
        # A single label is a network-local name -- `router`, `db`, `orion` --
        # and cannot be a public host.
        raise EgressRefused(f"{host} is a single-label internal name")


def _refuse_local_addresses(host: str) -> None:
    address = _as_address(host)
    if address is None:
        return
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    forbidden = (
        address.is_private,
        address.is_loopback,
        address.is_link_local,
        address.is_reserved,
        address.is_multicast,
        address.is_unspecified,
        address.version == 4 and address in CGNAT,
    )
    if any(forbidden):
        raise EgressRefused(f"{host} is not a public address")


def _as_address(host: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    candidate = host[1:-1] if host.startswith("[") and host.endswith("]") else host
    try:
        return ipaddress.ip_address(candidate)
    except ValueError:
        return None


def _is_address(host: str) -> bool:
    return _as_address(host) is not None
