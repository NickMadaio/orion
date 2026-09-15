"""Local SQLite device registry; persisted revocation is authoritative on every call.

All lifecycle methods still run DeviceRegistry's possession/owner checks. A
transaction reloads current records before those checks, then commits changes
atomically. Separate instances/processes cannot overwrite each other's revokes.
Pairing offers/challenges remain ephemeral: a restart invalidates unfinished work.
"""
from contextlib import contextmanager
from datetime import datetime
from functools import wraps
import json
import os
from pathlib import Path
import sqlite3
import stat
import threading

from backend.devices.identity import Attestation, DeviceIdentity
from backend.devices.registry import DeviceRecord, DeviceRegistry


class DeviceStoreError(RuntimeError):
    """The durable registry is unavailable or invalid; trust must not be inferred."""


def _encode(record):
    def date(value):
        return None if value is None else value.isoformat()
    return json.dumps(dict(
        device_id=str(record.device_id), user_id=str(record.user_id), name=record.name,
        platform=record.platform.value, public_key=record.identity.public_key,
        algorithm=str(record.identity.algorithm), hardware_backed_claim=record.identity.hardware_backed_claim,
        attestation=dict(state=record.attestation.state.value,
                         checked_at=date(record.attestation.checked_at), detail=record.attestation.detail),
        capabilities=list(record.capabilities), created_at=date(record.created_at),
        last_seen_at=date(record.last_seen_at), revoked_at=date(record.revoked_at), proven_by=record.proven_by,
    ), sort_keys=True, separators=(',', ':'), allow_nan=False)


def _decode(body):
    if not isinstance(body, str) or len(body.encode()) > 65536:
        raise DeviceStoreError('invalid device record size')
    try:
        value = json.loads(body)
        expected = {'device_id','user_id','name','platform','public_key','algorithm','hardware_backed_claim',
                    'attestation','capabilities','created_at','last_seen_at','revoked_at','proven_by'}
        if not isinstance(value, dict) or set(value) != expected:
            raise ValueError('invalid record shape')
        def date(item, required=False):
            if item is None and not required:
                return None
            if not isinstance(item, str): raise ValueError('invalid date')
            result = datetime.fromisoformat(item)
            if result.tzinfo is None or result.utcoffset() is None: raise ValueError('naive date')
            return result
        for field in ('device_id','user_id','name','platform','public_key','algorithm'):
            if not isinstance(value[field], str): raise ValueError('invalid string')
        attestation = value['attestation']
        if not isinstance(attestation, dict) or set(attestation) != {'state','checked_at','detail'}:
            raise ValueError('invalid attestation')
        if not isinstance(attestation['detail'], str): raise ValueError('invalid attestation detail')
        if not isinstance(value['capabilities'], list) or any(not isinstance(c, str) for c in value['capabilities']):
            raise ValueError('invalid capabilities')
        if value['proven_by'] is not None and not isinstance(value['proven_by'], str): raise ValueError('invalid provenance')
        return DeviceRecord(device_id=value['device_id'], user_id=value['user_id'], name=value['name'],
            platform=value['platform'], identity=DeviceIdentity(value['public_key'], value['algorithm'], value['hardware_backed_claim']),
            attestation=Attestation(attestation['state'], date(attestation['checked_at']), attestation['detail']),
            capabilities=tuple(value['capabilities']), created_at=date(value['created_at'], True),
            last_seen_at=date(value['last_seen_at']), revoked_at=date(value['revoked_at']), proven_by=value['proven_by'])
    except (ValueError, TypeError, KeyError) as error:
        raise DeviceStoreError('invalid persisted device record') from error


def _transactional(method):
    @wraps(method)
    def wrapped(self, *args, **kwargs):
        with self.transaction():
            return method(self, *args, **kwargs)
    return wrapped


class DurableDeviceRegistry(DeviceRegistry):
    """Explicit local store; not a production account/authentication service."""
    def __init__(self, directory: Path, challenges=None, verifier=None, *, create=False):
        super().__init__(challenges, verifier)
        self._directory = Path(directory).absolute()
        if create:
            self._directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self._check_private(self._directory, directory=True)
        self._path = self._directory / 'devices.sqlite3'
        # Creating and reopening are separate operations. Never turn a missing
        # or truncated established database into an apparently new account.
        if create:
            fd = os.open(self._path, os.O_CREAT | os.O_EXCL | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            os.close(fd)
        self._check_private(self._path)
        self._lock = threading.RLock()
        self._depth = 0
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            version = db.execute('PRAGMA user_version').fetchone()[0]
            tables = db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            if create and version == 0 and not tables:
                db.execute('CREATE TABLE devices (owner TEXT NOT NULL, device TEXT NOT NULL, public_key TEXT NOT NULL UNIQUE, body TEXT NOT NULL, PRIMARY KEY(owner,device))')
                db.execute('PRAGMA user_version=1')
            elif version != 1:
                raise DeviceStoreError('unsupported device database schema')
        # Validate at startup too. Never silently replace corrupt state with empty trust.
        with self.transaction():
            pass

    @staticmethod
    def _check_private(path, directory=False):
        info = path.lstat()
        kind = stat.S_ISDIR if directory else stat.S_ISREG
        if not kind(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise PermissionError('device storage must be private and owned by this user')

    @contextmanager
    def _connect(self):
        self._check_private(self._directory, directory=True)
        self._check_private(self._path)
        # mode=rw refuses a deleted database, rather than manufacturing an empty one.
        db = sqlite3.connect(self._path.as_uri() + '?mode=rw', uri=True, timeout=5)
        try:
            db.execute('PRAGMA synchronous=FULL')
            with db:
                yield db
        except sqlite3.Error as error:
            raise DeviceStoreError('device storage operation failed') from error
        finally:
            db.close()

    @contextmanager
    def transaction(self):
        with self._lock:
            if self._depth:
                yield
                return
            try:
                with self._connect() as db:
                    db.execute('BEGIN IMMEDIATE')
                    if db.execute('PRAGMA user_version').fetchone()[0] != 1:
                        raise DeviceStoreError('unsupported device database schema')
                    records = {}
                    before = {}
                    for owner, device, public_key, body in db.execute('SELECT owner,device,public_key,body FROM devices'):
                        record = _decode(body)
                        if (str(record.user_id), str(record.device_id), record.public_key) != (owner, device, public_key):
                            raise DeviceStoreError('device record identity mismatch')
                        records[(owner, device)] = record
                        before[(owner, device)] = _encode(record)
                    self._devices = records
                    self._depth = 1
                    try:
                        yield
                        for key, record in self._devices.items():
                            body = _encode(record)
                            _decode(body)  # Invalid input must not poison a future restart.
                            if before.get(key) != body:
                                db.execute('INSERT INTO devices VALUES(?,?,?,?) ON CONFLICT(owner,device) DO UPDATE SET body=excluded.body',
                                           (*key, record.public_key, body))
                    finally:
                        self._depth = 0
            finally:
                # No cached trust survives commit failure, rollback or completion.
                self._devices = {}

    register = _transactional(DeviceRegistry.register)
    adopt = _transactional(DeviceRegistry.adopt)
    touch = _transactional(DeviceRegistry.touch)
    revoke = _transactional(DeviceRegistry.revoke)
    record_attestation = _transactional(DeviceRegistry.record_attestation)
    list = _transactional(DeviceRegistry.list)
    _owned = _transactional(DeviceRegistry._owned)
