#!/usr/bin/env python3
"""Seed ORION OpenClaw Keychain items without printing credential values."""

from __future__ import annotations

import argparse
import ctypes
import io
import json
import os
import select
import sqlite3
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Protocol


ACCOUNT = "openclaw"
LOGIN_KEYCHAIN = Path.home() / "Library" / "Keychains" / "login.keychain-db"
SERVICES = {
    "gateway": "ORION OpenClaw Gateway",
    "anthropic": "ORION OpenClaw Anthropic",
    "ollama": "ORION OpenClaw Ollama",
}
ITEM_ORDER = tuple(SERVICES)


def nested_value(document: dict, path: tuple[str, ...]):
    value = document
    for component in path:
        if not isinstance(value, dict) or component not in value:
            return None
        value = value[component]
    return value


def source_values(
    config_path: Path, database_path: Path, names: tuple[str, ...] = ITEM_ORDER
) -> dict[str, str]:
    unknown = set(names) - set(ITEM_ORDER)
    if unknown:
        raise ValueError("unknown Keychain source name")
    values: dict[str, object] = {}
    if "gateway" in names or "anthropic" in names:
        config = json.loads(config_path.read_text(encoding="utf-8"))
        if not isinstance(config, dict):
            raise ValueError("OpenClaw config must be an object")
        if "gateway" in names:
            values["gateway"] = nested_value(config, ("gateway", "auth", "token"))
        if "anthropic" in names:
            values["anthropic"] = nested_value(
                config, ("models", "providers", "anthropic", "apiKey")
            )
    if "ollama" in names:
        with sqlite3.connect(f"file:{database_path}?mode=ro", uri=True) as database:
            row = database.execute(
                "SELECT store_json FROM auth_profile_store WHERE store_key = ?", ("primary",)
            ).fetchone()
        if row is None:
            raise ValueError("main auth profile store is missing")
        store = json.loads(row[0])
        values["ollama"] = nested_value(store, ("profiles", "ollama:local", "token"))
    normalized: dict[str, str] = {}
    for name, value in values.items():
        if not isinstance(value, str) or not value:
            raise ValueError(f"{name} plaintext source is missing or already migrated")
        normalized[name] = value
    return normalized


class Keychain(Protocol):
    def get(self, service: str) -> str | None: ...
    def add(self, service: str, value: str) -> bool: ...
    def delete(self, service: str) -> bool: ...


class MacKeychain:
    ITEM_NOT_FOUND = -25300

    def __init__(
        self,
        security: str = "/usr/bin/security",
        timeout: float = 45.0,
        keychain_path: Path = LOGIN_KEYCHAIN,
    ) -> None:
        self.security = security
        self.timeout = timeout
        self.keychain_path = keychain_path
        self._security_framework = ctypes.CDLL(
            "/System/Library/Frameworks/Security.framework/Security"
        )
        self._core_foundation = ctypes.CDLL(
            "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
        )
        self._configure_frameworks()

    def _configure_frameworks(self) -> None:
        security = self._security_framework
        security.SecKeychainOpen.argtypes = [
            ctypes.c_char_p,
            ctypes.POINTER(ctypes.c_void_p),
        ]
        security.SecKeychainOpen.restype = ctypes.c_int32
        security.SecKeychainAddGenericPassword.argtypes = [
            ctypes.c_void_p,
            ctypes.c_uint32,
            ctypes.c_char_p,
            ctypes.c_uint32,
            ctypes.c_char_p,
            ctypes.c_uint32,
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_void_p),
        ]
        security.SecKeychainAddGenericPassword.restype = ctypes.c_int32
        security.SecTrustedApplicationCreateFromPath.argtypes = [
            ctypes.c_char_p,
            ctypes.POINTER(ctypes.c_void_p),
        ]
        security.SecTrustedApplicationCreateFromPath.restype = ctypes.c_int32
        security.SecAccessCreate.argtypes = [
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_void_p),
        ]
        security.SecAccessCreate.restype = ctypes.c_int32
        security.SecKeychainItemSetAccess.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        security.SecKeychainItemSetAccess.restype = ctypes.c_int32
        security.SecKeychainItemDelete.argtypes = [ctypes.c_void_p]
        security.SecKeychainItemDelete.restype = ctypes.c_int32

        core = self._core_foundation
        core.CFStringCreateWithCString.argtypes = [
            ctypes.c_void_p,
            ctypes.c_char_p,
            ctypes.c_uint32,
        ]
        core.CFStringCreateWithCString.restype = ctypes.c_void_p
        core.CFArrayCreate.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_void_p),
            ctypes.c_long,
            ctypes.c_void_p,
        ]
        core.CFArrayCreate.restype = ctypes.c_void_p
        core.CFRelease.argtypes = [ctypes.c_void_p]

    def get(self, service: str) -> str | None:
        try:
            completed = subprocess.run(
                [
                    self.security,
                    "find-generic-password",
                    "-w",
                    "-a",
                    ACCOUNT,
                    "-s",
                    service,
                    str(self.keychain_path),
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=self.timeout,
            )
        except subprocess.TimeoutExpired as error:
            raise RuntimeError(f"Keychain read timed out for {service!r}") from error
        if completed.returncode == 44:
            return None
        if completed.returncode != 0:
            raise RuntimeError(f"Keychain read failed for {service!r} (exit {completed.returncode})")
        return completed.stdout.rstrip("\r\n")

    def add(self, service: str, value: str) -> bool:
        service_bytes = service.encode("utf-8")
        account_bytes = ACCOUNT.encode("utf-8")
        value_bytes = value.encode("utf-8")
        item = ctypes.c_void_p()
        trusted_application = ctypes.c_void_p()
        access = ctypes.c_void_p()
        keychain = ctypes.c_void_p()
        trusted_list = None
        descriptor = None
        added = False
        try:
            status = self._security_framework.SecKeychainOpen(
                os.fsencode(self.keychain_path), ctypes.byref(keychain)
            )
            if status != 0:
                return False
            status = self._security_framework.SecKeychainAddGenericPassword(
                keychain,
                len(service_bytes),
                service_bytes,
                len(account_bytes),
                account_bytes,
                len(value_bytes),
                ctypes.c_char_p(value_bytes),
                ctypes.byref(item),
            )
            if status != 0:
                return False
            added = True
            status = self._security_framework.SecTrustedApplicationCreateFromPath(
                self.security.encode("utf-8"), ctypes.byref(trusted_application)
            )
            if status != 0:
                return False
            values = (ctypes.c_void_p * 1)(trusted_application)
            callbacks = ctypes.c_void_p.in_dll(
                self._core_foundation, "kCFTypeArrayCallBacks"
            )
            trusted_list = self._core_foundation.CFArrayCreate(
                None, values, 1, ctypes.byref(callbacks)
            )
            descriptor = self._core_foundation.CFStringCreateWithCString(
                None, service_bytes, 0x08000100
            )
            if not trusted_list or not descriptor:
                return False
            status = self._security_framework.SecAccessCreate(
                descriptor, trusted_list, ctypes.byref(access)
            )
            if status != 0:
                return False
            status = self._security_framework.SecKeychainItemSetAccess(item, access)
            if status != 0:
                return False
            added = False
            return True
        finally:
            if added and item:
                self._security_framework.SecKeychainItemDelete(item)
            for reference in (
                access,
                descriptor,
                trusted_list,
                trusted_application,
                item,
                keychain,
            ):
                if reference:
                    self._core_foundation.CFRelease(reference)

    def delete(self, service: str) -> bool:
        completed = subprocess.run(
            [
                self.security,
                "delete-generic-password",
                "-a",
                ACCOUNT,
                "-s",
                service,
                str(self.keychain_path),
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=self.timeout,
        )
        return completed.returncode in (0, 44)


def statuses(values: dict[str, str], keychain: Keychain) -> dict[str, str]:
    result: dict[str, str] = {}
    for name in ITEM_ORDER:
        if name not in values:
            continue
        service = SERVICES[name]
        existing = keychain.get(service)
        if existing is None:
            result[name] = "missing"
        elif existing == values[name]:
            result[name] = "matches_source"
        else:
            result[name] = "differs_from_source"
    return result


def seed(values: dict[str, str], keychain: Keychain) -> dict[str, str]:
    before = statuses(values, keychain)
    if any(state == "differs_from_source" for state in before.values()):
        raise ValueError("existing Keychain item differs; manual review is required")
    added: list[str] = []
    try:
        for name in ITEM_ORDER:
            if name not in values:
                continue
            service = SERVICES[name]
            if before[name] == "matches_source":
                continue
            if not keychain.add(service, values[name]):
                raise RuntimeError(f"Keychain prompt/write failed for {name}")
            added.append(service)
            if keychain.get(service) != values[name]:
                raise RuntimeError(f"Keychain read-back mismatch for {name}")
    except BaseException:
        for service in reversed(added):
            keychain.delete(service)
        raise
    return statuses(values, keychain)


def render_status(result: dict[str, str]) -> str:
    return " ".join(f"{name}={result[name]}" for name in ITEM_ORDER if name in result)


def disposable_self_test(keychain: Keychain) -> bool:
    service = f"ORION V2 Disposable {uuid.uuid4().hex}"
    value = "orion-v2-nonsecret-disposable"
    try:
        if not keychain.add(service, value):
            return False
        return keychain.get(service) == value
    finally:
        keychain.delete(service)


def read_anthropic_secret(stream: io.TextIOBase) -> str:
    value = stream.read(4097)
    if len(value) > 4096:
        raise ValueError("Anthropic key input is too large")
    value = value.strip()
    if not value.startswith("sk-ant-") or not 50 <= len(value) <= 500:
        raise ValueError("Anthropic key input has an invalid shape")
    if any(character.isspace() for character in value):
        raise ValueError("Anthropic key input contains whitespace")
    return value


def clear_macos_clipboard() -> None:
    completed = subprocess.run(
        ["/usr/bin/pbcopy"],
        input=b"",
        capture_output=True,
        timeout=5,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError("macOS clipboard clear failed")


def validate_anthropic_fifo_path(path: Path) -> None:
    resolved_parent = path.parent.resolve()
    if resolved_parent != Path("/private/tmp"):
        raise ValueError("Anthropic FIFO must be directly under /private/tmp")
    if not path.name.startswith("orion-v2-anthropic-") or not path.name.endswith(".fifo"):
        raise ValueError("Anthropic FIFO name is invalid")


def read_anthropic_fifo(path: Path, timeout: float = 60.0) -> str:
    if path.exists():
        raise ValueError("Anthropic FIFO already exists")
    os.mkfifo(path, 0o600)
    descriptor = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    try:
        readable, _, _ = select.select([descriptor], [], [], timeout)
        if not readable:
            raise RuntimeError("Anthropic FIFO timed out")
        data = os.read(descriptor, 4097)
        try:
            text = data.decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise ValueError("Anthropic FIFO input is not UTF-8") from error
        return read_anthropic_secret(io.StringIO(text))
    finally:
        os.close(descriptor)
        path.unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    home = Path.home()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=home / ".openclaw/openclaw.json")
    parser.add_argument(
        "--database",
        type=Path,
        default=home / ".openclaw/agents/main/agent/openclaw-agent.sqlite",
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--status", action="store_true")
    mode.add_argument("--install", action="store_true")
    mode.add_argument("--install-anthropic-stdin", action="store_true")
    mode.add_argument("--install-anthropic-fifo", type=Path)
    mode.add_argument("--self-test-disposable", action="store_true")
    parser.add_argument("--confirm-live-values-to-keychain", action="store_true")
    parser.add_argument("--clear-macos-clipboard", action="store_true")
    parser.add_argument("--items", nargs="+", choices=ITEM_ORDER, default=list(ITEM_ORDER))
    arguments = parser.parse_args(argv)
    keychain = MacKeychain()

    if arguments.self_test_disposable:
        ok = disposable_self_test(keychain)
        print(f"keychain seed: disposable_self_test={'ok' if ok else 'FAIL'}")
        return 0 if ok else 1
    try:
        if arguments.install_anthropic_stdin:
            if not arguments.confirm_live_values_to_keychain:
                print("keychain seed: FAIL install requires --confirm-live-values-to-keychain")
                return 2
            try:
                values = {"anthropic": read_anthropic_secret(sys.stdin)}
            finally:
                if arguments.clear_macos_clipboard:
                    clear_macos_clipboard()
            result = seed(values, keychain)
            print(f"keychain seed: installed and verified ({render_status(result)})")
            return 0
        if arguments.install_anthropic_fifo is not None:
            if not arguments.confirm_live_values_to_keychain:
                print("keychain seed: FAIL install requires --confirm-live-values-to-keychain")
                return 2
            validate_anthropic_fifo_path(arguments.install_anthropic_fifo)
            values = {"anthropic": read_anthropic_fifo(arguments.install_anthropic_fifo)}
            result = seed(values, keychain)
            print(f"keychain seed: installed and verified ({render_status(result)})")
            return 0
        names = tuple(dict.fromkeys(arguments.items))
        values = source_values(arguments.config, arguments.database, names)
        if arguments.install:
            if not arguments.confirm_live_values_to_keychain:
                print("keychain seed: FAIL install requires --confirm-live-values-to-keychain")
                return 2
            result = seed(values, keychain)
            print(f"keychain seed: installed and verified ({render_status(result)})")
        else:
            print(f"keychain seed: status ({render_status(statuses(values, keychain))})")
    except (
        OSError,
        RuntimeError,
        ValueError,
        json.JSONDecodeError,
        sqlite3.Error,
        subprocess.SubprocessError,
    ) as error:
        print(f"keychain seed: FAIL {error}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
