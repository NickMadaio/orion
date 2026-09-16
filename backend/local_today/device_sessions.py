"""Short-lived local read grants bound to registered device possession.

A trusted local caller supplies a server-resolved Owner. This is not an account
sign-in endpoint. A fresh single-use signature is required for each grant; every
read rechecks the durable registry, so token lifetime cannot bypass revocation.
"""
from datetime import datetime
import secrets
import threading
import time

from backend.adapters.local_today import LocalReadSessions
from backend.devices.proofs import ChallengeStore
from backend.devices.registry import DeviceRejected
from backend.ownership import Session, resolve_owner


class DeviceReadSessions:
    def __init__(self, registry, *, clock=time.monotonic):
        self._registry = registry
        self._tokens = LocalReadSessions(clock)
        self._challenges = ChallengeStore()
        self._lock = threading.RLock()

    @staticmethod
    def message(owner, device_id, public_key, challenge):
        return f'local-read-session-v1|{owner.user_id}|{device_id}|{public_key}|{challenge}'.encode('utf-8')

    def _active(self, owner, device_id):
        record = self._registry._owned(owner, device_id)
        if record.revoked or not record.attestation.usable:
            raise DeviceRejected('device cannot open a read session')
        return record

    def begin(self, owner, device_id: str, *, now: datetime):
        with self._lock, self._registry.transaction():
            record = self._active(owner, device_id)
            purpose = self._purpose(owner, record)
            return self._challenges.issue(purpose, now=now)

    def exchange(self, owner, device_id: str, *, challenge: str, signature: bytes,
                 now: datetime, lifetime=300) -> str:
        with self._lock, self._registry.transaction():
            # Spend before proof checks. A failed signature cannot be probed again.
            record = self._registry._owned(owner, device_id)
            self._challenges.spend(challenge, self._purpose(owner, record), now=now)
            self._active(owner, device_id)
            self._registry._require_matching_algorithm(record.identity)
            if not self._registry._verifier.verify(record.public_key,
                    self.message(owner, device_id, record.public_key, challenge), signature):
                raise DeviceRejected('device did not prove possession for this read session')
            session = Session('local-read-' + secrets.token_hex(16), str(owner.user_id), str(record.device_id))
            return self._tokens.issue(session, lifetime=lifetime)

    def resolve(self, header):
        with self._lock:
            session = self._tokens.resolve(header)
            if session is None:
                return None
            try:
                self._active(resolve_owner(session), session.device_id)
            except DeviceRejected:
                # Terminal invalidation: restoring attestation must not revive a token.
                self._tokens.revoke(header[7:])
                return None
            # Storage failures propagate to the HTTP boundary as 503, never trust.
            return session

    def revoke(self, token):
        with self._lock:
            self._tokens.revoke(token)

    @staticmethod
    def _purpose(owner, record):
        return f'local-read-session|{owner.user_id}|{record.device_id}|{record.public_key}'
