#!/usr/bin/env python3
"""Thin client for the ORION TTS daemon.

`orion-local-tts` (zsh) is the entry point OpenClaw actually spawns; this file
is the part of it that has to speak a socket protocol, which zsh cannot do.
It is deliberately stdlib-only and imports nothing heavy, so interpreter
start-up stays in the tens of milliseconds instead of the tens of seconds a
cold MLX model load costs.

Contract::

    orion_tts_client.py OUTPUT_PATH TEXT

Exit codes::

    0   OUTPUT_PATH now holds a complete WAV written by the daemon
    10  give up -- caller must fall back to /usr/bin/say
    64  wrong usage

The client never blocks indefinitely. Every phase is bounded by a slice of one
total budget, and a SIGALRM watchdog is armed before any I/O as a last resort.
Running out of budget is not an error, it is a fallback: the user hears the
`say` voice instead of silence.
"""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import time
import uuid
from typing import Any, Iterator, Optional

EXIT_OK = 0
EXIT_FALLBACK = 10
EXIT_USAGE = 64

WAV_HEADER_BYTES = 44

DEFAULT_SOCKET = "~/.openclaw/orion-tts.sock"
DEFAULT_CLIENT_LOG = "~/.openclaw/logs/orion-tts-client.log"
DEFAULT_DAEMON_LOG = "~/.openclaw/logs/orion-tts.autostart.log"
DEFAULT_MLX_CLI = "~/.local/bin/mlx_audio.tts.generate"


# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------


def _int(env: dict, name: str, default: int) -> int:
    raw = env.get(name, "")
    try:
        return int(float(raw)) if str(raw).strip() else default
    except (TypeError, ValueError):
        return default


def _bool(env: dict, name: str, default: bool) -> bool:
    raw = str(env.get(name, "")).strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


class Options:
    """Everything tunable, resolved once from the environment."""

    def __init__(self, env: Optional[dict] = None) -> None:
        env = dict(os.environ if env is None else env)
        self.env = env
        self.socket_path = os.path.expanduser(
            env.get("ORION_TTS_SOCKET") or DEFAULT_SOCKET
        )
        # Total wall-clock budget for this invocation. Must stay comfortably
        # under talk.providers["tts-local-cli"].timeoutMs in openclaw.json,
        # because that outer timeout kills us instead of falling back.
        self.budget_ms = _int(env, "ORION_TTS_CLIENT_BUDGET_MS", 6000)
        # How long to wait for a daemon we just autostarted. A cold MLX load
        # takes far longer than this; the point is not to wait for it but to
        # let it come up in the background while this utterance uses `say`.
        self.start_wait_ms = _int(env, "ORION_TTS_START_WAIT_MS", 1500)
        # Reserved at the end of the budget so `say` still has time to run.
        self.reserve_ms = _int(env, "ORION_TTS_FALLBACK_RESERVE_MS", 1200)
        self.connect_ms = _int(env, "ORION_TTS_CONNECT_MS", 300)
        self.autostart = _bool(env, "ORION_TTS_AUTOSTART", True)
        self.preempt = _bool(env, "ORION_TTS_PREEMPT", False)
        self.voice = (env.get("ORION_TTS_VOICE") or "").strip()
        self.speed = (env.get("ORION_TTS_SPEED") or "").strip()
        self.daemon_path = env.get("ORION_TTS_DAEMON") or os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "orion_tts_daemon.py"
        )
        self.python = (env.get("ORION_TTS_PYTHON") or "").strip()
        self.mlx_cli = os.path.expanduser(
            env.get("ORION_TTS_MLX_CLI") or DEFAULT_MLX_CLI
        )
        self.log_path = os.path.expanduser(
            env.get("ORION_TTS_CLIENT_LOG") or DEFAULT_CLIENT_LOG
        )
        self.daemon_log = os.path.expanduser(
            env.get("ORION_TTS_AUTOSTART_LOG") or DEFAULT_DAEMON_LOG
        )
        self.verbose = _bool(env, "ORION_TTS_CLIENT_VERBOSE", False)


# ---------------------------------------------------------------------------
# Logging (never logs the spoken text -- it is the user's private speech)
# ---------------------------------------------------------------------------


def log_line(options: Options, message: str) -> None:
    if not options.log_path:
        return
    try:
        os.makedirs(os.path.dirname(options.log_path), exist_ok=True)
        stamp = time.strftime("%Y-%m-%dT%H:%M:%S")
        with open(options.log_path, "a", encoding="utf-8") as handle:
            handle.write(f"{stamp} [orion-tts-client] {message}\n")
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Protocol framing
# ---------------------------------------------------------------------------


def iter_frames(sock: socket.socket, deadline: float) -> Iterator[dict]:
    """Yield NDJSON frames from `sock` until EOF or `deadline` (monotonic).

    Frames are newline-delimited, so a single recv may hold several frames or
    half of one. Anything that is not a JSON object is skipped rather than
    fatal, so a stray log line on the socket cannot wedge the client.
    """
    buffer = b""
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("daemon did not answer within the budget")
        sock.settimeout(min(remaining, 0.5))
        try:
            data = sock.recv(65536)
        except socket.timeout:
            continue
        except OSError as exc:
            raise ConnectionError(str(exc)) from exc
        if not data:
            break
        buffer += data
        while b"\n" in buffer:
            raw, buffer = buffer.split(b"\n", 1)
            frame = _decode(raw)
            if frame is not None:
                yield frame
    frame = _decode(buffer)
    if frame is not None:
        yield frame


def _decode(raw: bytes) -> Optional[dict]:
    text = raw.strip()
    if not text:
        return None
    try:
        value = json.loads(text.decode("utf-8", "replace"))
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def is_terminal(frame: dict) -> bool:
    """True when `frame` ends the request. Progress frames are not terminal."""
    if frame.get("event") == "chunk":
        return False
    return "ok" in frame


def send_json(sock: socket.socket, payload: dict) -> None:
    sock.sendall((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))


# ---------------------------------------------------------------------------
# Connection / autostart
# ---------------------------------------------------------------------------


def connect(socket_path: str, timeout_s: float) -> Optional[socket.socket]:
    """Connect to the daemon, or return None. Never raises."""
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        sock.settimeout(max(0.05, timeout_s))
        sock.connect(socket_path)
    except OSError:
        try:
            sock.close()
        except OSError:
            pass
        return None
    return sock


def resolve_daemon_python(options: Options) -> str:
    """Pick the interpreter that can actually import mlx_audio.

    `~/.local/bin/mlx_audio.tts.generate` is a console-script wrapper, so its
    shebang names exactly the interpreter the model is installed under. That
    is a far better guess than whatever python is first on PATH.
    """
    if options.python:
        return options.python
    shebang = _shebang_interpreter(options.mlx_cli)
    if shebang:
        return shebang
    for name in ("python3", "python"):
        found = _which(name, options.env)
        if found:
            return found
    return sys.executable


def _shebang_interpreter(path: str) -> Optional[str]:
    try:
        with open(path, "rb") as handle:
            first = handle.readline(512).decode("utf-8", "replace").strip()
    except OSError:
        return None
    if not first.startswith("#!"):
        return None
    parts = first[2:].strip().split()
    if not parts:
        return None
    candidate = parts[0]
    # "#!/usr/bin/env python3" -> take the argument instead.
    if os.path.basename(candidate) == "env" and len(parts) > 1:
        return _which(parts[1], dict(os.environ))
    return candidate if os.access(candidate, os.X_OK) else None


def _which(name: str, env: dict) -> Optional[str]:
    if os.path.sep in name:
        return name if os.access(name, os.X_OK) else None
    for directory in (env.get("PATH") or os.defpath).split(os.pathsep):
        candidate = os.path.join(directory, name)
        if os.access(candidate, os.X_OK):
            return candidate
    return None


def claim_start_lock(socket_path: str, ttl_s: int = 90) -> bool:
    """Best-effort single-spawner lock so N concurrent replies start one daemon."""
    lock_path = socket_path + ".start"
    try:
        age = time.time() - os.path.getmtime(lock_path)
        if age < ttl_s:
            return False
        os.unlink(lock_path)
    except OSError:
        pass
    try:
        handle = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except OSError:
        return False
    try:
        os.write(handle, str(os.getpid()).encode("ascii"))
    finally:
        os.close(handle)
    return True


def spawn_daemon(options: Options) -> bool:
    """Start the daemon detached. Returns False if it could not be launched."""
    if not os.path.exists(options.daemon_path):
        log_line(options, f"autostart skipped: no daemon at {options.daemon_path}")
        return False
    if not claim_start_lock(options.socket_path):
        return True  # someone else is already starting it; just wait
    python = resolve_daemon_python(options)
    try:
        os.makedirs(os.path.dirname(options.daemon_log), exist_ok=True)
        stream = open(options.daemon_log, "a", encoding="utf-8")
    except OSError:
        stream = None
    try:
        subprocess.Popen(
            [python, options.daemon_path],
            stdin=subprocess.DEVNULL,
            stdout=stream or subprocess.DEVNULL,
            stderr=subprocess.STDOUT if stream else subprocess.DEVNULL,
            start_new_session=True,
            close_fds=True,
            cwd=os.path.dirname(os.path.abspath(options.daemon_path)) or None,
        )
    except OSError as exc:
        log_line(options, f"autostart failed: {exc}")
        return False
    finally:
        if stream is not None:
            try:
                stream.close()
            except OSError:
                pass
    log_line(options, f"autostart: {python} {options.daemon_path}")
    return True


def connect_or_start(options: Options, deadline: float) -> Optional[socket.socket]:
    """Connect, autostarting the daemon if needed, without ever exceeding budget."""
    sock = connect(options.socket_path, options.connect_ms / 1000.0)
    if sock is not None:
        return sock
    if not options.autostart:
        return None
    if not spawn_daemon(options):
        return None
    wait_until = min(deadline, time.monotonic() + options.start_wait_ms / 1000.0)
    while time.monotonic() < wait_until:
        time.sleep(0.05)
        sock = connect(options.socket_path, 0.1)
        if sock is not None:
            log_line(options, "connected to freshly started daemon")
            return sock
    return None


# ---------------------------------------------------------------------------
# Output validation
# ---------------------------------------------------------------------------


def looks_like_wav(path: str) -> bool:
    try:
        if os.path.getsize(path) <= WAV_HEADER_BYTES:
            return False
        with open(path, "rb") as handle:
            head = handle.read(12)
    except OSError:
        return False
    return head[:4] == b"RIFF" and head[8:12] == b"WAVE"


# ---------------------------------------------------------------------------
# Main flow
# ---------------------------------------------------------------------------


def build_request(job_id: str, text: str, output_path: str, options: Options,
                  deadline_ms: int) -> dict:
    request: dict[str, Any] = {
        "op": "synth",
        "id": job_id,
        "mode": "file",
        "text": text,
        "output": output_path,
        "deadline_ms": max(1, deadline_ms),
        "allow_partial": False,
    }
    if options.preempt:
        request["preempt"] = True
    if options.voice:
        request["voice"] = options.voice
    if options.speed:
        try:
            request["speed"] = float(options.speed)
        except ValueError:
            pass
    return request


def best_effort_cancel(options: Options, job_id: str) -> None:
    """Stop a job we abandoned, so it cannot overwrite the `say` output later."""
    sock = connect(options.socket_path, 0.2)
    if sock is None:
        return
    try:
        send_json(sock, {"op": "cancel", "id": job_id})
        sock.settimeout(0.2)
        try:
            sock.recv(4096)
        except OSError:
            pass
    except OSError:
        pass
    finally:
        try:
            sock.close()
        except OSError:
            pass


def speak(output_path: str, text: str, options: Options) -> int:
    started = time.monotonic()
    deadline = started + options.budget_ms / 1000.0
    job_id = f"cli-{uuid.uuid4().hex[:10]}"

    if not text.strip():
        log_line(options, "empty text -> fallback")
        return EXIT_FALLBACK

    sock = connect_or_start(options, deadline)
    if sock is None:
        log_line(
            options,
            f"no daemon on {options.socket_path} after "
            f"{int((time.monotonic() - started) * 1000)}ms -> say fallback",
        )
        return EXIT_FALLBACK

    synth_deadline = deadline - options.reserve_ms / 1000.0
    remaining_ms = int((synth_deadline - time.monotonic()) * 1000)
    if remaining_ms <= 0:
        sock.close()
        log_line(options, "budget spent before synthesis -> say fallback")
        return EXIT_FALLBACK

    request = build_request(job_id, text, output_path, options, remaining_ms)
    try:
        send_json(sock, request)
        terminal: Optional[dict] = None
        for frame in iter_frames(sock, synth_deadline):
            if is_terminal(frame):
                terminal = frame
                break
    except (OSError, TimeoutError, ConnectionError) as exc:
        _close(sock)
        best_effort_cancel(options, job_id)
        log_line(options, f"{type(exc).__name__}: {exc} -> say fallback")
        return EXIT_FALLBACK
    finally:
        _close(sock)

    elapsed = int((time.monotonic() - started) * 1000)
    if terminal is None:
        best_effort_cancel(options, job_id)
        log_line(options, f"daemon closed without a result in {elapsed}ms -> say")
        return EXIT_FALLBACK
    if not terminal.get("ok"):
        code = terminal.get("code", "error")
        log_line(options, f"daemon said {code}: {terminal.get('error')} -> say")
        return EXIT_FALLBACK
    if not looks_like_wav(output_path):
        log_line(options, f"daemon reported ok but {output_path} is not a WAV -> say")
        return EXIT_FALLBACK

    if options.verbose:
        log_line(
            options,
            f"ok engine={terminal.get('engine')} chunks={terminal.get('chunks')} "
            f"daemon_ms={terminal.get('ms')} client_ms={elapsed} "
            f"chars={len(text)}",
        )
    return EXIT_OK


def _close(sock: socket.socket) -> None:
    try:
        sock.close()
    except OSError:
        pass


def _arm_watchdog(options: Options) -> None:
    """Hard ceiling. If anything wedges, exit with the fallback code."""
    seconds = max(1, int((options.budget_ms + options.reserve_ms) / 1000.0) + 1)

    def _bail(_signum: int, _frame: Any) -> None:
        log_line(options, f"watchdog fired after {seconds}s -> say fallback")
        os._exit(EXIT_FALLBACK)

    try:
        signal.signal(signal.SIGALRM, _bail)
        signal.alarm(seconds)
    except (AttributeError, ValueError, OSError):
        pass


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: orion_tts_client.py OUTPUT_PATH TEXT", file=sys.stderr)
        return EXIT_USAGE
    options = Options()
    _arm_watchdog(options)
    try:
        return speak(argv[0], argv[1], options)
    except Exception as exc:  # noqa: BLE001 - a client crash must still speak
        log_line(options, f"unexpected {type(exc).__name__}: {exc} -> say fallback")
        return EXIT_FALLBACK
    finally:
        try:
            signal.alarm(0)
        except (AttributeError, ValueError, OSError):
            pass


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
