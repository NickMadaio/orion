"""A decrypted secret that disposes of itself, and refuses to be printed.

"Dispose of plaintext immediately after use" cannot be a comment on a variable.
So a decrypted secret is borrowed: inside the `with`, the bytes exist; at the end
of it the buffer is overwritten and every further read raises.

The three ways a secret actually reaches a log are an f-string, a debugger, and
`json.dumps` of a dict somebody thought was safe. All three are refused by type
here rather than caught by a pattern later -- which is also how "never provide
tokens to ORION models" is enforced: a Borrowed value is not JSON, so Phase 3's
context bundle, Phase 6's audit details and Phase 7's event payload each refuse
it without knowing anything about secrets.
"""

from __future__ import annotations

from types import TracebackType


class SecretExpired(RuntimeError):
    """The borrow ended. The value is gone, deliberately."""


class SecretExposure(RuntimeError):
    """Something tried to render a secret as text.

    Raising rather than returning "***" on purpose: a redacted string in a log is
    a bug that looks handled, and the caller should be changed rather than
    tidied.
    """


class Borrowed:
    """A secret, available only inside its `with` block."""

    __slots__ = ("_buffer", "_open", "_label", "_produce", "_produced")

    def __init__(self, value, label: str = "secret") -> None:
        """`value` may be bytes, or a zero-argument callable producing them.

        A callable is the point: `borrow()` used to decrypt EAGERLY and the
        `with` was optional, so `b = vault.borrow(...)` that was never entered
        left the plaintext sitting in the buffer with nothing to dispose of it.
        Deferring the decryption to `__enter__` means a borrow that is never
        entered never produces a secret at all.
        """

        if callable(value):
            self._produce = value
            self._buffer = bytearray()
            self._produced = False
        else:
            if not isinstance(value, (bytes, bytearray)) or not value:
                raise ValueError("a borrowed secret must be non-empty bytes")
            self._produce = None
            self._buffer = bytearray(value)
            self._produced = True
        self._open = False
        self._label = label

    def __enter__(self) -> bytes:
        if self._produced and not self._buffer:
            raise SecretExpired(f"{self._label} has already been disposed of")
        if not self._produced:
            produced = self._produce()
            if not isinstance(produced, (bytes, bytearray)) or not produced:
                raise ValueError("a borrowed secret must be non-empty bytes")
            self._buffer = bytearray(produced)
            self._produced = True
        self._open = True
        return bytes(self._buffer)

    def __del__(self) -> None:
        # Dropping the reference disposes it. Without this, a borrow that was
        # never entered -- or one whose `with` was skipped -- left the plaintext
        # alive for as long as the object was.
        try:
            self.dispose()
        except Exception:
            pass

    def __exit__(
        self,
        exception_type: type[BaseException] | None,
        exception: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.dispose()

    def dispose(self) -> None:
        """Overwrite the buffer, then empty it.

        Overwriting first because CPython may not return the memory promptly;
        zeroing what is there is the part that is actually under our control.
        """

        for index in range(len(self._buffer)):
            self._buffer[index] = 0
        self._buffer.clear()
        self._open = False

    @property
    def disposed(self) -> bool:
        return self._produced and not self._buffer

    def __repr__(self) -> str:
        raise SecretExposure(f"{self._label} must not be rendered")

    __str__ = __repr__

    def __format__(self, specification: str) -> str:
        raise SecretExposure(f"{self._label} must not be formatted into a string")

    def __bytes__(self) -> bytes:
        raise SecretExposure(f"{self._label} is only readable inside its borrow")

    def __eq__(self, other: object) -> bool:
        # Comparison would be an oracle: `secret == b"guess"` in a loop reads a
        # secret one byte at a time in the worst case, and one guess at a time in
        # the best.
        raise SecretExposure(f"{self._label} does not compare")

    __hash__ = None  # type: ignore[assignment]
