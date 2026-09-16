"""Single-use local bootstrap grants for device-signed read-session exchange.

The trusted host chooses owner/device before issuing a bootstrap grant. HTTP
clients cannot choose an account, register a device, or obtain a grant here.
"""
import base64
import binascii
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import secrets
import threading
import time

from backend.devices.proofs import ChallengeRejected
from backend.devices.registry import DeviceRejected


class ExchangeRejected(PermissionError):
    pass


@dataclass
class _Bootstrap:
    owner: object
    device: str
    public_key: str
    deadline: float
    challenge: str | None = None


class LocalSessionExchange:
    def __init__(self, sessions, *, clock=time.monotonic, now=lambda: datetime.now(timezone.utc)):
        self.sessions = sessions
        self.clock = clock
        self.now = now
        self._grants = {}
        self._lock = threading.RLock()

    def authorize(self, owner, device):
        with self._lock:
            record = self.sessions._active(owner, device)
            token = secrets.token_urlsafe(32)
            self._grants[self._hash(token)] = _Bootstrap(owner, device, record.public_key, self.clock()+120)
            return token

    def revoke(self, token):
        with self._lock:
            self._grants.pop(self._hash(token), None)

    @staticmethod
    def _hash(token):
        return hashlib.sha256(token.encode()).digest()

    def handle(self, path, header, body):
        if not isinstance(header, str) or not header.startswith('Bearer ') or len(header)>128:
            raise ExchangeRejected()
        with self._lock:
            key = self._hash(header[7:])
            grant = self._grants.get(key)
            if grant is None or self.clock() >= grant.deadline:
                self._grants.pop(key, None)
                raise ExchangeRejected()
            if path == '/session/challenge':
                if body != {} or grant.challenge is not None:
                    raise ExchangeRejected()
                try:
                    challenge = self.sessions.begin(grant.owner, grant.device, now=self.now())
                except DeviceRejected as error:
                    self._grants.pop(key, None)
                    raise ExchangeRejected() from error
                grant.challenge = challenge.value
                return dict(schema=1, ownerID=str(grant.owner.user_id), deviceID=grant.device,
                            publicKey=grant.public_key, challenge=challenge.value, expiresAt=challenge.expires_at.timestamp())
            if path != '/session/exchange':
                raise ExchangeRejected()
            # Consume before proof parsing, verification or storage. An uncertain
            # exchange requires a new deliberate grant, never a repeat issuance.
            self._grants.pop(key, None)
            if (set(body) != {'challenge','signature'} or not isinstance(body['challenge'], str)
                    or body['challenge'] != grant.challenge or not isinstance(body['signature'], str)
                    or len(body['signature']) > 128):
                raise ExchangeRejected()
            try:
                signature = base64.b64decode(body['signature'], validate=True)
                token = self.sessions.exchange(grant.owner, grant.device, challenge=body['challenge'],
                    signature=signature, now=self.now())
            except (ValueError, binascii.Error, DeviceRejected, ChallengeRejected) as error:
                raise ExchangeRejected() from error
            return dict(schema=1, ownerID=str(grant.owner.user_id), deviceID=grant.device, token=token)
