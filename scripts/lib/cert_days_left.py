#!/usr/bin/env python3
"""
Days until a code-signing certificate expires, given its SHA-1 fingerprint.

Reads `security find-certificate -a -Z -p` on stdin. That command prints, for
every certificate in the keychain, a SHA-1 line followed by the PEM block:

    SHA-1 hash: 171A72AB4922A629DE353811E065CE2C5820AC09
    ...
    -----BEGIN CERTIFICATE-----
    ...

Matching on the fingerprint rather than the common name is the whole point.
This Mac has six certificates named "Orion Local Signing", five of them failed
imports that were never trusted, and `find-certificate -c <name>` returns
whichever one it finds first. The build resolves the identity to a hash for
exactly this reason; the expiry check has to use the same hash or it can end up
reporting the wrong certificate's date with total confidence.

Prints the number of days (negative when already expired) and exits 0, or
prints nothing and exits 1 when the certificate cannot be found or read.
"""

import subprocess
import sys
from datetime import datetime, timezone


def blocks(stream):
    """Yield (sha1, pem) for each certificate in `find-certificate -a -Z -p`."""
    sha1 = None
    pem = []
    for line in stream:
        if line.startswith("SHA-1 hash:"):
            sha1 = line.split(":", 1)[1].strip().upper()
            pem = []
        elif line.startswith("-----BEGIN CERTIFICATE-----"):
            pem = [line]
        elif pem:
            pem.append(line)
            if line.startswith("-----END CERTIFICATE-----"):
                if sha1:
                    yield sha1, "".join(pem)
                pem = []


def not_after(pem):
    """The certificate's expiry, via openssl. None when it will not parse."""
    try:
        result = subprocess.run(
            ["openssl", "x509", "-noout", "-enddate"],
            input=pem, capture_output=True, text=True, timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    raw = result.stdout.strip()
    if not raw.startswith("notAfter="):
        return None
    stamp = raw.split("=", 1)[1].strip()
    # "Jul 31 00:32:35 2027 GMT" — the only format openssl emits here.
    for form in ("%b %d %H:%M:%S %Y %Z", "%b %d %H:%M:%S %Y"):
        try:
            parsed = datetime.strptime(stamp.replace(" GMT", ""), form.replace(" %Z", ""))
            return parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def main():
    if len(sys.argv) < 2:
        return 1
    wanted = sys.argv[1].strip().upper().replace(" ", "")

    for sha1, pem in blocks(sys.stdin):
        if sha1.replace(" ", "") != wanted:
            continue
        expires = not_after(pem)
        if expires is None:
            return 1
        remaining = expires - datetime.now(timezone.utc)
        print(remaining.days)
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
