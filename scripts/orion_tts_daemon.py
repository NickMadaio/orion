#!/usr/bin/env python3
"""ORION persistent TTS daemon.

Why this exists
---------------
The previous pipeline (`orion-local-tts` -> `mlx_audio.tts.generate`) spawned a
fresh Python process for EVERY spoken reply, which reloaded the 250M MLX Marvis
model from disk each time. That cold-start cost is paid on every single turn and
dominates perceived voice latency.

This daemon loads the model ONCE, keeps it warm in memory, and answers synthesis
requests over a unix domain socket. It also splits input on sentence boundaries
and synthesizes chunk-by-chunk so the first chunk is available almost
immediately (see `mode: "stream"`).

Protocol
--------
Newline-delimited JSON (NDJSON) in both directions. One request per line, one or
more response frames per request.

Requests::

    {"op": "ping"}
    {"op": "status"}
    {"op": "synth", "text": "...", "output": "/tmp/x.wav"}        # file mode
    {"op": "synth", "text": "...", "mode": "stream"}              # chunk frames
    {"op": "synth", "text": "...", "mode": "stream", "play": true} # daemon plays
    {"op": "cancel"}                    # cancel every in-flight + queued job
    {"op": "cancel", "id": "job-7"}     # cancel one job
    {"op": "shutdown"}

`synth` options: ``id``, ``mode`` (``file``|``stream``), ``output``, ``voice``,
``speed``, ``preempt`` (cancel other jobs first -- barge-in), ``deadline_ms``,
``allow_partial``, ``encode`` (``path``|``base64``, stream mode only), ``play``.

Responses (file mode)::

    {"ok": true, "id": "...", "output": "...", "engine": "mlx-warm",
     "chunks": 3, "ms": 812, "first_chunk_ms": 173, "cached_chunks": 1}
    {"ok": false, "id": "...", "error": "...", "code": "cancelled"}

Responses (stream mode)::

    {"event": "chunk", "id": "...", "index": 0, "text": "...", "ms": 173,
     "path": "/.../chunk_000.wav"}      # or "audio_b64": "..."
    {"event": "done", "ok": true, "id": "...", "chunks": 3, "ms": 812}

Everything in this file above the ``__main__`` guard is import-safe and free of
MLX imports, so the pure logic (chunking, WAV joining, protocol) is unit
testable on any platform. See ``tests/test_tts_daemon.py``.
"""

from __future__ import annotations

import base64
import concurrent.futures
import errno
import io
import json
import os
import queue
import re
import shutil
import signal
import socket
import subprocess
import pathlib
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
import wave
from collections import OrderedDict
from typing import Any, Callable, Iterable, Optional
from urllib.parse import quote

# --------------------------------------------------------------------------
# Configuration (all env-overridable so the user can tune without editing code)
# --------------------------------------------------------------------------

HOME = os.path.expanduser("~")

DEFAULT_MODEL = os.path.join(
    HOME,
    ".cache/huggingface/hub/mlx-audio",
    "Marvis-AI_marvis-tts-250m-v0.2-MLX-8bit",
)
DEFAULT_MLX_CLI = os.path.join(HOME, ".local/bin/mlx_audio.tts.generate")
DEFAULT_SOCKET = os.path.join(HOME, ".openclaw/orion-tts.sock")
DEFAULT_RUNTIME_DIR = os.path.join(HOME, ".openclaw/tmp/orion-tts")

SAY_BIN = "/usr/bin/say"


def _env(name: str, default: str) -> str:
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        # Fall back to the dotenv file for ORION_* settings.
        #
        # Without this, only the API keys were read from .env (via read_secret)
        # while every other setting had to be an environment variable. Choosing
        # a voice by writing ORION_ELEVEN_VOICE_ID into .env would have looked
        # like it worked and changed nothing — the worst kind of bug, and the
        # same silent-no-op shape that has cost hours already today.
        if name.startswith("ORION_"):
            for path in env_file_candidates():
                found = read_env_file(path, name)
                if found and found.strip():
                    return found.strip()
        return default
    return value.strip()


def _env_float(name: str, default: float) -> float:
    try:
        return float(_env(name, str(default)))
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(float(_env(name, str(default))))
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = _env(name, "1" if default else "0").lower()
    return raw in ("1", "true", "yes", "on")


# --------------------------------------------------------------------------
# Credentials  (env first, then the gitignored .env -- never logged)
# --------------------------------------------------------------------------

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_ENV_FILE = os.path.join(REPO_ROOT, ".env")


def env_file_candidates() -> list[str]:
    """Where a key may live, best first. `.env` is gitignored by design."""
    explicit = os.environ.get("ORION_ENV_FILE", "").strip()
    if explicit:
        return [explicit]
    return [DEFAULT_ENV_FILE, os.path.join(HOME, "Desktop/ORION/.env")]


def read_env_file(path: str, name: str) -> Optional[str]:
    """Return `name` from a dotenv file, or None.

    Only the key that was asked for is ever returned, so a caller cannot walk
    the file and collect unrelated secrets by accident.
    """
    try:
        with open(path, "r", encoding="utf-8") as handle:
            lines = handle.read().splitlines()
    except OSError:
        return None
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        if key.strip() != name:
            continue
        value = value.strip().strip('"').strip("'")
        return value or None
    return None


# Keychain items for credentials this daemon uses, following the Phase 0 naming
# already established for the OpenClaw values ("ORION OpenClaw Anthropic" etc).
# The role contract and the inference ledger, if this daemon can reach them.
# Imported defensively: launchd starts this with its own interpreter and the
# repo may not be importable. Telemetry is never worth losing the voice for, so
# a failed import degrades to the behaviour this daemon has always had.
try:
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
    from orion.mac import inference_ledger as _ledger
except Exception:  # pragma: no cover - depends on how launchd starts us
    _ledger = None


def contract_model(role: str, default: str) -> str:
    """The model for a role, or the compiled-in default."""
    if _ledger is None:
        return default
    try:
        return _ledger.resolve(role, default)
    except Exception:
        return default


def record_synthesis(
    reference: str,
    latency_ms: int,
    *,
    outcome: str = "succeeded",
    failure_reason: Optional[str] = None,
    fell_back_from: Optional[str] = None,
) -> None:
    """Append one row for a synthesis. Silent on every failure, by design."""
    if _ledger is None:
        return
    try:
        _ledger.append(
            "tts",
            reference,
            latency_ms,
            source="tts_daemon",
            outcome=outcome,
            failure_reason=failure_reason,
            fell_back_from=fell_back_from,
        )
    except Exception:
        pass


KEYCHAIN_ITEMS = {
    "ELEVENLABS_API_KEY": "ORION ElevenLabs",
    "DEEPGRAM_API_KEY": "ORION Deepgram",
}


def read_keychain(item: str) -> Optional[str]:
    """Read one login-Keychain generic password, or None.

    Runs as the user, so this does not hit the per-binary ACL problem that makes
    the Swift app re-prompt after every rebuild -- a script is not a signed
    binary with a sealed identity. `-w` prints only the secret, and stderr is
    discarded so a "not found" never lands in a log next to the item name.
    """
    try:
        result = subprocess.run(
            # Account "openclaw" matches the items Phase 0 already created; a
            # different account name here would silently never find them.
            ["/usr/bin/security", "find-generic-password", "-a", "openclaw",
             "-s", item, "-w"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    value = result.stdout.strip()
    return value or None


def read_secret(name: str, candidates: Optional[list[str]] = None) -> Optional[str]:
    """Environment, then Keychain, then `.env`.

    Keychain sits ahead of `.env` deliberately: it makes the migration a no-op
    switch. Seed the Keychain item, restart, and the daemon prefers it without
    any other change; the plaintext line can then be removed once that is proven
    rather than before. Phase 0 learned this order the hard way -- verify the new
    source works BEFORE deleting the old one.

    The return value is a live credential. It is passed straight into a request
    header and is never logged, never echoed into a frame, and never written
    into openclaw.json.
    """
    value = os.environ.get(name, "").strip()
    if value:
        return value
    item = KEYCHAIN_ITEMS.get(name)
    if item:
        found = read_keychain(item)
        if found:
            return found
    for path in (candidates if candidates is not None else env_file_candidates()):
        found = read_env_file(path, name)
        if found:
            return found
    return None


def secret_source(name: str, candidates: Optional[list[str]] = None) -> str:
    """Where the credential came from. Names the SOURCE, never the value.

    This is what lets a diagnostic prove the migration landed without anyone
    printing a key to check.
    """
    if os.environ.get(name, "").strip():
        return "environment"
    item = KEYCHAIN_ITEMS.get(name)
    if item and read_keychain(item):
        return "keychain"
    for path in (candidates if candidates is not None else env_file_candidates()):
        if read_env_file(path, name):
            return "env_plaintext"
    return "absent"


def secret_present(name: str, candidates: Optional[list[str]] = None) -> bool:
    """Presence only. This is the ONLY thing any diagnostic may report."""
    return read_secret(name, candidates) is not None


class Config:
    """Snapshot of tunables, read once at startup."""

    def __init__(self) -> None:
        self.model_path = _env("ORION_TTS_MODEL", DEFAULT_MODEL)
        # The contract names the model; DEFAULT_MODEL stays the fallback so a
        # missing contract cannot cost Orion its voice.
        self.tts_model_name = contract_model(
            "tts", os.path.basename(self.model_path)
        )
        self.mlx_cli = _env("ORION_TTS_MLX_CLI", DEFAULT_MLX_CLI)
        self.voice = _env("ORION_TTS_VOICE", "conversational_b")
        # 1.0 == the model's natural rate. The old script hard-coded 0.94,
        # which deliberately slowed every reply down.
        self.speed = _env_float("ORION_TTS_SPEED", 1.0)
        self.sample_rate = _env_int("ORION_TTS_SAMPLE_RATE", 24000)
        self.socket_path = _env("ORION_TTS_SOCKET", DEFAULT_SOCKET)
        self.tcp_port = _env_int("ORION_TTS_TCP_PORT", 0)
        self.tcp_token = os.environ.get("ORION_TTS_TOKEN", "")
        self.runtime_dir = _env("ORION_TTS_RUNTIME_DIR", DEFAULT_RUNTIME_DIR)
        self.queue_max = max(1, _env_int("ORION_TTS_QUEUE_MAX", 4))
        # Small first chunk => audio is ready sooner. Later chunks can be
        # bigger because they are only needed by the time the first finishes.
        self.first_chunk_chars = max(16, _env_int("ORION_TTS_FIRST_CHUNK_CHARS", 90))
        self.chunk_chars = max(32, _env_int("ORION_TTS_CHUNK_CHARS", 240))
        self.gap_ms = max(0, _env_int("ORION_TTS_GAP_MS", 60))
        self.cache_entries = max(0, _env_int("ORION_TTS_CACHE_ENTRIES", 64))
        self.warmup_text = _env("ORION_TTS_WARMUP_TEXT", "Online.")
        self.warmup = _env_bool("ORION_TTS_WARMUP", True)
        self.play_cmd = _env("ORION_TTS_PLAY_CMD", "/usr/bin/afplay")
        self.chunk_ttl_s = max(5, _env_int("ORION_TTS_CHUNK_TTL_S", 120))
        self.engine_pref = _env("ORION_TTS_ENGINE", "auto").lower()
        self.log_path = os.environ.get("ORION_TTS_LOG", "")

        # --- ElevenLabs (cloud voice) ---
        # Opt-in on purpose: with ORION_TTS_ENGINE=auto and this off, the daemon
        # stays entirely local even if a key happens to be present.
        self.eleven_opt_in = _env_bool("ORION_TTS_CLOUD_VOICE", False)
        self.eleven_base_url = _env("ORION_ELEVEN_BASE_URL", "https://api.elevenlabs.io")
        # Rachel, the account-independent default voice. Override per taste.
        self.eleven_voice_id = _env("ORION_ELEVEN_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
        # Flash is the low-latency model (~75ms model time, per ElevenLabs);
        # eleven_multilingual_v2 is the higher-fidelity, slower alternative.
        self.eleven_model = _env("ORION_ELEVEN_MODEL", "eleven_flash_v2_5")
        self.eleven_stability = _env_float("ORION_ELEVEN_STABILITY", 0.4)
        self.eleven_similarity = _env_float("ORION_ELEVEN_SIMILARITY", 0.75)
        self.eleven_style = _env_float("ORION_ELEVEN_STYLE", 0.0)
        self.eleven_speaker_boost = _env_bool("ORION_ELEVEN_SPEAKER_BOOST", True)
        # Blank => pcm at the daemon's own sample rate, so nothing resamples.
        self.eleven_output_format = _env("ORION_ELEVEN_OUTPUT_FORMAT", "")
        self.eleven_timeout_s = _env_float("ORION_ELEVEN_TIMEOUT_S", 10.0)
        self.eleven_stall_s = _env_float("ORION_ELEVEN_STALL_S", 6.0)
        # Small first segment => audio leaves the daemon sooner.
        self.eleven_first_segment_ms = _env_int("ORION_ELEVEN_FIRST_SEGMENT_MS", 120)
        self.eleven_segment_ms = _env_int("ORION_ELEVEN_SEGMENT_MS", 400)
        # Read once, held in memory, never logged and never written anywhere.
        self.eleven_api_key = read_secret("ELEVENLABS_API_KEY")


CONFIG = Config()

# --------------------------------------------------------------------------
# Logging
# --------------------------------------------------------------------------

_log_lock = threading.Lock()
_log_stream = sys.stderr


def _open_log() -> None:
    global _log_stream
    if not CONFIG.log_path:
        return
    try:
        os.makedirs(os.path.dirname(CONFIG.log_path), exist_ok=True)
        _log_stream = open(CONFIG.log_path, "a", buffering=1, encoding="utf-8")
    except OSError:
        _log_stream = sys.stderr


def log(message: str, level: str = "info") -> None:
    stamp = time.strftime("%Y-%m-%dT%H:%M:%S")
    line = f"{stamp} [orion-tts] {level}: {message}"
    with _log_lock:
        try:
            print(line, file=_log_stream, flush=True)
        except (OSError, ValueError):
            pass


def preview(text: str, limit: int = 60) -> str:
    flat = " ".join(text.split())
    if len(flat) <= limit:
        return flat
    return flat[:limit] + "..."


# --------------------------------------------------------------------------
# Sentence splitting / chunking  (pure, unit tested)
# --------------------------------------------------------------------------

# Abbreviations that NEVER end a sentence, because what follows them is a
# proper noun that is capitalised anyway ("Dr. Smith", "St. Louis"). Looking at
# the next word cannot disambiguate these, so they always suppress the break.
_TITLE_ABBREVIATIONS = frozenset(
    """
    mr mrs ms mx dr prof sr jr st mt rev hon gen col sgt capt lt cmdr
    messrs fr adm maj supt det ofc pres gov sen rep
    """.split()
)

# Abbreviations that only suppress a sentence break when the next word
# continues in lower case. This matters: "no", "sat", "sun", "est", "co" and
# friends are ordinary English words, and a Jarvis-style assistant says
# "The answer is no. Let me explain." constantly. Treating that "no." as an
# abbreviation would glue two sentences into one chunk and cost latency.
_CONTEXT_ABBREVIATIONS = frozenset(
    """
    vs etc eg ie al approx est fig no nos dept inc ltd llc co corp univ
    jan feb mar apr jun jul aug sept sep oct nov dec
    mon tue tues wed thu thur thurs fri sat sun
    ave blvd rd apt ste fl hwy ln pkwy
    vol ch sec pp cf ca cca min max qty
    """.split()
)

# End-of-sentence punctuation runs, optionally followed by closing quotes.
_SENTENCE_END = re.compile(r"([.!?…]+)([\"'”’)\]]*)(\s|$)")

# Soft boundaries used only to break up an over-long sentence, best first.
_SOFT_BOUNDARIES = (
    re.compile(r";\s+"),
    re.compile(r":\s+"),
    re.compile(r"\s+[—–-]{1,2}\s+"),
    re.compile(r",\s+"),
)


ALWAYS = "always"
CONTEXT = "context"
NOT_ABBREV = ""


def abbreviation_kind(text: str, dot_index: int) -> str:
    """Classify the '.' at `dot_index`.

    Returns ``ALWAYS`` (never a sentence end), ``CONTEXT`` (only a sentence end
    when the next word starts a new sentence) or ``NOT_ABBREV``.
    """
    start = dot_index
    while start > 0 and (text[start - 1].isalnum() or text[start - 1] == "."):
        start -= 1
    core = text[start:dot_index].lower().rstrip(".")
    if not core:
        # Nothing but punctuation in front: an ellipsis at the start of a run.
        return NOT_ABBREV
    if "." in core:
        # Dotted acronym: "u.s", "e.g", "a.k.a", "ph.d". Real words never have
        # interior dots, so short segments are a reliable signal.
        segments = [part for part in core.split(".") if part]
        return CONTEXT if all(len(part) <= 2 for part in segments) else NOT_ABBREV
    # Single letters are initials: "J. R. R. Tolkien", "A. Smith".
    if len(core) == 1 and core.isalpha():
        return ALWAYS
    if core in _TITLE_ABBREVIATIONS:
        return ALWAYS
    if core in _CONTEXT_ABBREVIATIONS:
        return CONTEXT
    return NOT_ABBREV


def starts_new_sentence(text: str, index: int) -> bool:
    """True if the text at/after `index` looks like the start of a sentence."""
    cursor = index
    while cursor < len(text) and text[cursor].isspace():
        cursor += 1
    while cursor < len(text) and text[cursor] in "\"'“‘([":
        cursor += 1
    if cursor >= len(text):
        # End of block is a real boundary; the caller drops the empty tail.
        return True
    return text[cursor].isupper()


_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
         "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
_TENS = ["", "", "twenty", "thirty", "forty", "fifty"]
_CLOCK = re.compile(r"\b(\d{1,2}):(\d{2})(?:\s*([AaPp])\.?\s*[Mm]\.?(?![A-Za-z]))?")


def _minute_words(minute: int) -> str:
    if minute == 0:
        return ""
    if minute < 10:
        return f"oh {_ONES[minute]}"
    if minute < 20:
        return _ONES[minute]
    tens, ones = divmod(minute, 10)
    return _TENS[tens] + (f" {_ONES[ones]}" if ones else "")


def spoken_times(text: str) -> str:
    """Clock times written the way they are said (2026-09-29).

    The Flash voice model does not normalise numbers itself: "It's 8:14 PM."
    came out with the ending slurred. Written as words it is read cleanly, and a
    24-hour time is said the way Nick says it ("20:11" -> "eight eleven PM").
    """
    def say(match: "re.Match[str]") -> str:
        hour, minute = int(match.group(1)), int(match.group(2))
        if hour > 23 or minute > 59:
            return match.group(0)
        marker = match.group(3)
        # The regex may swallow the sentence's full stop with "p.m."; give it back.
        after = match.string[match.end():match.end() + 2]
        ends_sentence = after == "" or after[:1] == "\n" or (after[:1] == " " and after[1:2].isupper())
        stop = "." if match.group(0).endswith(".") and ends_sentence else ""
        if marker:
            half = "A M" if marker.lower() == "a" else "P M"
        elif hour == 0 and minute == 0:
            return "midnight" + stop
        elif hour == 12 and minute == 0:
            return "noon" + stop
        elif hour >= 13 or hour == 0:
            half = "P M" if hour >= 12 else "A M"
        else:
            half = ""  # "3:45" on its own: say the numbers, invent no AM or PM
        hour12 = hour % 12 or 12
        tail = _minute_words(minute)
        spoken = f"{_ONES[hour12]} {tail}".strip() if tail else (_ONES[hour12] if half else f"{_ONES[hour12]} o'clock")
        return f"{spoken} {half}".strip() + stop
    return _CLOCK.sub(say, text)


def split_sentences(text: str) -> list[str]:
    """Split text into sentences without losing any characters.

    Conservative: paragraph breaks are hard boundaries, abbreviations and
    initials do not end a sentence, and decimals stay intact because a
    sentence end requires trailing whitespace or end-of-string.
    """
    if not text or not text.strip():
        return []

    parts: list[str] = []
    for block in re.split(r"\n\s*\n+", text):
        if not block.strip():
            continue
        parts.extend(_split_block(block))
    return parts


def _split_block(block: str) -> list[str]:
    sentences: list[str] = []
    cursor = 0
    for match in _SENTENCE_END.finditer(block):
        run = match.group(1)
        end = match.end(2)
        if run.endswith("."):
            # Index of the final '.' in this punctuation run.
            kind = abbreviation_kind(block, match.start(1) + len(run) - 1)
            if kind == ALWAYS:
                continue
            if kind == CONTEXT and not starts_new_sentence(block, end):
                continue
        candidate = block[cursor:end].strip()
        if candidate:
            sentences.append(candidate)
        cursor = end
    tail = block[cursor:].strip()
    if tail:
        sentences.append(tail)
    return sentences


def _split_long(fragment: str, limit: int) -> list[str]:
    """Break an over-long fragment on soft boundaries, then on words."""
    if len(fragment) <= limit:
        return [fragment]

    for pattern in _SOFT_BOUNDARIES:
        pieces = _split_keep(fragment, pattern)
        if len(pieces) > 1:
            out: list[str] = []
            for piece in pieces:
                out.extend(_split_long(piece, limit))
            return _repack(out, limit)

    # No soft boundary left: split on words.
    words = fragment.split()
    out = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and len(candidate) > limit:
            out.append(current)
            current = word
        else:
            current = candidate
    if current:
        out.append(current)
    return out


def _split_keep(text: str, pattern: re.Pattern[str]) -> list[str]:
    """Split on `pattern`, keeping the separator glued to the left piece."""
    pieces: list[str] = []
    cursor = 0
    for match in pattern.finditer(text):
        piece = text[cursor : match.end()].strip()
        if piece:
            pieces.append(piece)
        cursor = match.end()
    tail = text[cursor:].strip()
    if tail:
        pieces.append(tail)
    return pieces if pieces else [text]


def _repack(pieces: Iterable[str], limit: int) -> list[str]:
    """Greedily merge adjacent pieces while staying under `limit`."""
    out: list[str] = []
    for piece in pieces:
        if out and len(out[-1]) + 1 + len(piece) <= limit:
            out[-1] = f"{out[-1]} {piece}"
        else:
            out.append(piece)
    return out


def chunk_text(
    text: str,
    first_max: int = 90,
    max_chars: int = 240,
) -> list[str]:
    """Split `text` into synthesis chunks, smallest first.

    Chunk 0 is kept short so the first audio is ready as early as possible;
    later chunks are larger to amortise per-chunk overhead. No words are lost.
    """
    sentences = split_sentences(text)
    if not sentences:
        return []

    chunks: list[str] = []
    pending = ""

    def limit() -> int:
        # The limit has to be recomputed after every flush: once chunk 0 exists
        # the budget widens from `first_max` to `max_chars`.
        return first_max if not chunks else max_chars

    def flush() -> None:
        nonlocal pending
        if pending:
            chunks.append(pending)
            pending = ""

    for sentence in sentences:
        for piece in _split_long(sentence, limit()):
            if not pending:
                pending = piece
            elif len(pending) + 1 + len(piece) <= limit():
                pending = f"{pending} {piece}"
            else:
                flush()
                pending = piece
            if len(pending) >= limit():
                flush()
    flush()
    return [c for c in (chunk.strip() for chunk in chunks) if c]


# --------------------------------------------------------------------------
# WAV helpers  (pure, unit tested -- no numpy/soundfile required)
# --------------------------------------------------------------------------


class WavMismatch(RuntimeError):
    """Raised when chunks cannot be concatenated because formats differ."""


def wav_bytes_from_pcm(
    pcm: bytes,
    sample_rate: int,
    channels: int = 1,
    sample_width: int = 2,
) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(channels)
        handle.setsampwidth(sample_width)
        handle.setframerate(sample_rate)
        handle.writeframes(pcm)
    return buffer.getvalue()


def read_wav(data: bytes) -> tuple[tuple[int, int, int], bytes]:
    """Return ((channels, sample_width, framerate), frames)."""
    with wave.open(io.BytesIO(data), "rb") as handle:
        params = (
            handle.getnchannels(),
            handle.getsampwidth(),
            handle.getframerate(),
        )
        frames = handle.readframes(handle.getnframes())
    return params, frames


def join_wav_bytes(chunks: list[bytes], gap_ms: int = 0) -> bytes:
    """Concatenate same-format WAV blobs, inserting `gap_ms` of silence."""
    if not chunks:
        raise ValueError("join_wav_bytes: no chunks")
    if len(chunks) == 1 and gap_ms <= 0:
        return chunks[0]

    base_params: Optional[tuple[int, int, int]] = None
    frames: list[bytes] = []
    for index, blob in enumerate(chunks):
        params, data = read_wav(blob)
        if base_params is None:
            base_params = params
        elif params != base_params:
            raise WavMismatch(
                f"chunk {index} format {params} != {base_params}"
            )
        if frames and gap_ms > 0:
            frames.append(_silence(base_params, gap_ms))
        frames.append(data)

    assert base_params is not None
    channels, sample_width, framerate = base_params
    return wav_bytes_from_pcm(
        b"".join(frames), framerate, channels=channels, sample_width=sample_width
    )


def _silence(params: tuple[int, int, int], gap_ms: int) -> bytes:
    channels, sample_width, framerate = params
    frame_count = int(framerate * gap_ms / 1000)
    return b"\x00" * (frame_count * channels * sample_width)


def wav_duration_ms(data: bytes) -> int:
    params, frames = read_wav(data)
    channels, sample_width, framerate = params
    frame_size = max(1, channels * sample_width)
    return int(1000 * (len(frames) / frame_size) / max(1, framerate))


def pcm16_from_audio(audio: Any) -> bytes:
    """Convert model output (mx.array / numpy / list / bytes) to int16 LE PCM."""
    if isinstance(audio, (bytes, bytearray, memoryview)):
        return bytes(audio)

    try:
        import numpy as np  # noqa: PLC0415 -- optional, only on the MLX path
    except ImportError:
        return _pcm16_from_iterable(audio)

    try:
        array = np.asarray(audio)
    except (TypeError, ValueError):
        try:
            array = np.asarray(audio.tolist())
        except Exception as exc:  # pragma: no cover - defensive
            raise TypeError(f"unsupported audio payload: {type(audio)!r}") from exc

    array = np.reshape(array, (-1,))
    if array.dtype == np.int16:
        return array.astype("<i2", copy=False).tobytes()
    if np.issubdtype(array.dtype, np.integer):
        return array.astype("<i2", copy=False).tobytes()
    scaled = np.clip(array.astype("float32"), -1.0, 1.0) * 32767.0
    return scaled.astype("<i2").tobytes()


def _pcm16_from_iterable(audio: Any) -> bytes:
    try:
        values = list(audio.tolist())  # type: ignore[union-attr]
    except AttributeError:
        values = list(audio)
    flat: list[float] = []
    stack = [values]
    while stack:
        item = stack.pop(0)
        if isinstance(item, (list, tuple)):
            stack = list(item) + stack
        else:
            flat.append(float(item))
    out = bytearray()
    for value in flat:
        clamped = max(-1.0, min(1.0, value))
        out += int(clamped * 32767.0).to_bytes(2, "little", signed=True)
    return bytes(out)


# --------------------------------------------------------------------------
# ElevenLabs helpers  (pure, unit tested -- no network)
# --------------------------------------------------------------------------

# The `output_format` enum's PCM rates, per the ElevenLabs API reference.
# 44.1kHz PCM needs a Pro subscription; the rest are broadly available.
ELEVEN_PCM_RATES = (8000, 16000, 22050, 24000, 44100)

# An ElevenLabs voice id: 20-ish opaque alphanumerics. Deliberately strict so a
# local model voice name ("conversational_b") can never be mistaken for one.
_ELEVEN_VOICE_ID = re.compile(r"^[A-Za-z0-9]{16,64}$")


def elevenlabs_output_format(sample_rate: int, override: str = "") -> tuple[str, int]:
    """Return (output_format, the rate the bytes will actually arrive at).

    Raw PCM on purpose. The daemon's frames are WAV, so a `pcm_*` response only
    needs a 44-byte header glued on -- no decoder, no subprocess, no extra
    buffering. MP3 would put a decode step in the exact hot path this daemon
    exists to shorten, so it is refused rather than silently accepted.
    """
    if override:
        cleaned = override.strip().lower()
        if not cleaned.startswith("pcm_"):
            raise ValueError(
                f"unsupported ORION_ELEVEN_OUTPUT_FORMAT {cleaned!r}: only pcm_* "
                "is supported, because anything else needs a decoder in the "
                "audio path"
            )
        try:
            rate = int(cleaned.split("_", 1)[1])
        except (IndexError, ValueError) as exc:
            raise ValueError(f"malformed output format {cleaned!r}") from exc
        if rate <= 0:
            raise ValueError(f"malformed output format {cleaned!r}")
        return cleaned, rate
    # Ask for the rate the rest of the pipeline already runs at, so nothing
    # downstream has to resample.
    rate = min(ELEVEN_PCM_RATES, key=lambda candidate: (abs(candidate - sample_rate), candidate))
    return f"pcm_{rate}", rate


def elevenlabs_voice_id(requested: str, default: str) -> str:
    """Pick the voice id for one request.

    Requests carry the *local* model's voice name, which means nothing to
    ElevenLabs. Only an override actually shaped like an ElevenLabs voice id is
    honoured; everything else falls back to the configured voice.
    """
    candidate = (requested or "").strip()
    if candidate and _ELEVEN_VOICE_ID.match(candidate):
        return candidate
    return default


def segment_bytes(sample_rate: int, milliseconds: int, frame_bytes: int = 2) -> int:
    """Bytes of int16 mono PCM that hold `milliseconds` of audio."""
    frames = max(1, int(sample_rate * max(1, milliseconds) / 1000))
    return frames * frame_bytes


def emit_length(pending: int, minimum: int, frame_bytes: int = 2) -> int:
    """How many buffered PCM bytes to release as a frame; 0 means keep waiting.

    Always a whole number of samples: a WAV whose data chunk ends mid-sample
    plays as a click, and the frames are concatenated on the other side.
    """
    if pending < minimum or pending < frame_bytes:
        return 0
    return pending - (pending % frame_bytes)


# --------------------------------------------------------------------------
# Synthesis engines
# --------------------------------------------------------------------------


class EngineError(RuntimeError):
    pass


class Cancelled(RuntimeError):
    pass


class Engine:
    name = "base"

    #: Does this engine stream a whole utterance itself?
    #:
    #: The local model does not, so we split text into chunks and synthesise
    #: them one at a time to get first audio out quickly. That is the right
    #: trade for a model running on this Mac.
    #:
    #: It is the WRONG trade for a cloud engine that already streams. Chunking
    #: there means a separate HTTP request per fragment, each with its own
    #: independently-chosen prosody, joined with inserted silence — which is
    #: exactly what "super choppy" sounds like. Engines that stream natively
    #: get the whole text in one request.
    streams_natively = False

    def synth(
        self,
        text: str,
        voice: str,
        speed: float,
        cancel: threading.Event,
    ) -> bytes:
        raise NotImplementedError

    def stream(
        self,
        text: str,
        voice: str,
        speed: float,
        cancel: threading.Event,
    ) -> Iterable[bytes]:
        """Audio for `text` in playable pieces, earliest first.

        One piece by default: a local model hands back the whole chunk at once,
        so there is nothing to release early. Network engines override this so
        the first frame can leave the daemon while the rest is still arriving.
        """
        yield self.synth(text, voice, speed, cancel)


class MlxWarmEngine(Engine):
    """The fast path: model loaded once, kept resident, invoked per chunk."""

    name = "mlx-warm"

    def __init__(self, model_path: str, sample_rate: int) -> None:
        self.model_path = model_path
        self.default_sample_rate = sample_rate
        self._signature: Optional[dict[str, bool]] = None

        # MLX streams are THREAD-LOCAL.
        #
        # Load the model on one thread and call generate() from another and
        # every call dies with "There is no Stream(gpu, N) in current thread",
        # which this daemon dutifully caught and degraded from -- straight to
        # `say`, at 3.2s to first audio, for every single reply. The warm
        # engine was never actually used.
        #
        # So the model is confined to exactly one thread: this executor loads
        # it, generates on it, and converts its output to plain PCM bytes on
        # it. Nothing holding an mx.array ever crosses a thread boundary.
        #
        # Serialising synthesis costs nothing here anyway -- there is one GPU
        # and the jobs were already queued.
        self._mlx = concurrent.futures.ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="orion-mlx"
        )
        self.model = self._mlx.submit(self._load, model_path).result()

    def close(self) -> None:
        self._mlx.shutdown(wait=False)

    @staticmethod
    def _load(model_path: str) -> Any:
        errors: list[str] = []
        loaders: list[tuple[str, Callable[[], Any]]] = []

        def _from_utils() -> Any:
            from mlx_audio.tts.utils import load_model  # noqa: PLC0415

            return load_model(model_path)

        def _from_generate() -> Any:
            from mlx_audio.tts.generate import load_model  # noqa: PLC0415

            return load_model(model_path)

        loaders.append(("mlx_audio.tts.utils.load_model", _from_utils))
        loaders.append(("mlx_audio.tts.generate.load_model", _from_generate))

        for label, loader in loaders:
            try:
                model = loader()
            except Exception as exc:  # noqa: BLE001 - probing optional APIs
                errors.append(f"{label}: {exc}")
                continue
            if not hasattr(model, "generate"):
                errors.append(f"{label}: loaded object has no .generate()")
                continue
            log(f"model loaded via {label}")
            return model
        raise EngineError("; ".join(errors) or "no MLX loader available")

    def _generate(self, text: str, voice: str, speed: float) -> Any:
        """Call model.generate, tolerating signature differences across versions."""
        full = {"text": text, "voice": voice, "speed": speed, "verbose": False}
        attempts: list[dict[str, Any]] = [full]
        for drop in (("verbose",), ("verbose", "speed"), ("verbose", "speed", "voice")):
            attempts.append({k: v for k, v in full.items() if k not in drop})

        last: Optional[BaseException] = None
        for kwargs in attempts:
            try:
                return self.model.generate(**kwargs)
            except TypeError as exc:
                last = exc
                continue
        raise EngineError(f"model.generate signature rejected: {last}")

    def synth(
        self,
        text: str,
        voice: str,
        speed: float,
        cancel: threading.Event,
    ) -> bytes:
        if cancel.is_set():
            raise Cancelled("cancelled before synthesis")
        # Everything that touches the model or its arrays runs on the one MLX
        # thread and comes back as bytes. See the note in __init__.
        pcm, sample_rate = self._mlx.submit(
            self._synth_on_mlx_thread, text, voice, speed, cancel
        ).result()
        return wav_bytes_from_pcm(pcm, sample_rate)

    def _synth_on_mlx_thread(
        self,
        text: str,
        voice: str,
        speed: float,
        cancel: threading.Event,
    ) -> tuple[bytes, int]:
        result = self._generate(text, voice, speed)
        pcm_parts: list[bytes] = []
        sample_rate = self.default_sample_rate

        for item in self._iter_results(result):
            if cancel.is_set():
                raise Cancelled("cancelled mid-synthesis")
            audio = getattr(item, "audio", item)
            rate = getattr(item, "sample_rate", None)
            if isinstance(rate, (int, float)) and rate > 0:
                sample_rate = int(rate)
            pcm_parts.append(pcm16_from_audio(audio))

        if not pcm_parts:
            raise EngineError("model produced no audio")
        return b"".join(pcm_parts), sample_rate

    @staticmethod
    def _iter_results(result: Any) -> Iterable[Any]:
        if result is None:
            return []
        if hasattr(result, "audio"):
            return [result]
        if isinstance(result, (list, tuple)):
            return list(result)
        if hasattr(result, "__iter__") and not isinstance(result, (str, bytes)):
            return list(result)
        return [result]


class MlxGenerateFnEngine(Engine):
    """In-process fallback using mlx_audio's module-level generate_audio()."""

    name = "mlx-generate-fn"

    def __init__(self, model_path: str) -> None:
        self.model_path = model_path
        from mlx_audio.tts.generate import generate_audio  # noqa: PLC0415

        self._generate_audio = generate_audio

    def synth(
        self,
        text: str,
        voice: str,
        speed: float,
        cancel: threading.Event,
    ) -> bytes:
        if cancel.is_set():
            raise Cancelled("cancelled before synthesis")
        with tempfile.TemporaryDirectory(prefix="orion-tts-gen-") as tmp:
            prefix = "chunk"
            self._generate_audio(
                text=text,
                model_path=self.model_path,
                voice=voice,
                speed=speed,
                file_prefix=prefix,
                audio_format="wav",
                join_audio=True,
                output_path=tmp,
                verbose=False,
            )
            produced = _find_wav(tmp, prefix)
            if not produced:
                raise EngineError("generate_audio produced no wav")
            with open(produced, "rb") as handle:
                return handle.read()


class MlxCliEngine(Engine):
    """Last-resort MLX path: the original CLI, one process per chunk.

    Still pays model load per call, so it exists only so voice keeps working
    when the in-process APIs are unavailable.
    """

    name = "mlx-cli"

    def __init__(self, cli_path: str, model_path: str) -> None:
        self.cli_path = cli_path
        self.model_path = model_path

    def synth(
        self,
        text: str,
        voice: str,
        speed: float,
        cancel: threading.Event,
    ) -> bytes:
        if cancel.is_set():
            raise Cancelled("cancelled before synthesis")
        with tempfile.TemporaryDirectory(prefix="orion-tts-cli-") as tmp:
            prefix = "chunk"
            command = [
                self.cli_path,
                "--model", self.model_path,
                "--text", text,
                "--voice", voice,
                "--speed", str(speed),
                "--output_path", tmp,
                "--file_prefix", prefix,
                "--audio_format", "wav",
                "--join_audio",
            ]
            proc = subprocess.run(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            if proc.returncode != 0:
                raise EngineError(
                    f"mlx cli exit {proc.returncode}: "
                    f"{proc.stderr.decode('utf-8', 'replace')[:400]}"
                )
            produced = _find_wav(tmp, prefix)
            if not produced:
                raise EngineError("mlx cli produced no wav")
            with open(produced, "rb") as handle:
                return handle.read()


class SayEngine(Engine):
    """Guaranteed fallback so the assistant never goes silent."""

    name = "say"

    def __init__(self, sample_rate: int = 24000) -> None:
        self.sample_rate = sample_rate

    def synth(
        self,
        text: str,
        voice: str,
        speed: float,
        cancel: threading.Event,
    ) -> bytes:
        if cancel.is_set():
            raise Cancelled("cancelled before synthesis")
        with tempfile.TemporaryDirectory(prefix="orion-tts-say-") as tmp:
            out = os.path.join(tmp, "say.wav")
            command = [
                SAY_BIN,
                "--file-format=WAVE",
                f"--data-format=LEI16@{self.sample_rate}",
                "-o", out,
                text,
            ]
            proc = subprocess.run(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            if proc.returncode != 0 or not os.path.exists(out):
                raise EngineError(
                    f"say exit {proc.returncode}: "
                    f"{proc.stderr.decode('utf-8', 'replace')[:200]}"
                )
            with open(out, "rb") as handle:
                return handle.read()


_STREAM_DONE = object()


class ElevenLabsEngine(Engine):
    """Cloud voice: ElevenLabs streaming text-to-speech.

    Ears and mouth only. This engine sends TEXT THAT IS ALREADY GOING TO BE
    SPOKEN and receives audio bytes. It never carries a user request to a model,
    never runs a tool, and never touches the gateway. If you are ever tempted to
    put anything else on this socket, don't -- that is the whole architecture.

    Why the streaming endpoint and not the batch one: `POST .../stream` starts
    returning audio while the sentence is still being generated, so the first
    frame can leave the daemon (and start playing in Orion.app) long before the
    request finishes. The batch endpoint would give up exactly the latency this
    provider exists to win.

    Why PCM and not MP3: `output_format=pcm_<rate>` is raw int16 little-endian
    at a rate we choose, so producing a WAV frame is a 44-byte header. MP3 would
    need a decoder in the hot path.

    The API key travels in the `xi-api-key` header. It is never put in the URL,
    never logged, and is scrubbed out of any error text before that text is
    logged.
    """

    name = "elevenlabs"
    streams_natively = True

    def __init__(
        self,
        config: "Config",
        api_key: Optional[str],
        opener: Optional[Callable[..., Any]] = None,
    ) -> None:
        if not api_key:
            raise EngineError("no ElevenLabs API key")
        self._api_key = api_key
        self.base_url = config.eleven_base_url.rstrip("/")
        self.voice_id = config.eleven_voice_id
        self.model = config.eleven_model
        self.stability = config.eleven_stability
        self.similarity = config.eleven_similarity
        self.style = config.eleven_style
        self.speaker_boost = config.eleven_speaker_boost
        self.connect_timeout = config.eleven_timeout_s
        self.stall_timeout = config.eleven_stall_s
        self.first_segment_ms = config.eleven_first_segment_ms
        self.segment_ms = config.eleven_segment_ms
        self.output_format, self.sample_rate = elevenlabs_output_format(
            config.sample_rate, config.eleven_output_format
        )
        self._opener = opener or self._open

    # -- description (safe to log; contains no credential) ----------------

    def describe(self) -> dict[str, Any]:
        return {
            "voice_id": self.voice_id,
            "model": self.model,
            "output_format": self.output_format,
            "sample_rate": self.sample_rate,
        }

    # -- request ----------------------------------------------------------

    def _voice_settings(self, speed: float) -> dict[str, Any]:
        settings: dict[str, Any] = {
            "stability": self.stability,
            "similarity_boost": self.similarity,
            "use_speaker_boost": self.speaker_boost,
        }
        if self.style > 0:
            settings["style"] = self.style
        # Only sent when the user actually changed it: `speed` is rejected by
        # some models, and a 422 here would knock the cloud voice out entirely.
        if abs(speed - 1.0) > 0.01:
            settings["speed"] = max(0.7, min(1.2, speed))
        return settings

    def _open(self, text: str, voice_id: str, speed: float) -> Any:
        url = (
            f"{self.base_url}/v1/text-to-speech/{quote(voice_id, safe='')}/stream"
            f"?output_format={quote(self.output_format, safe='')}"
        )
        payload = json.dumps({
            "text": text,
            "model_id": self.model,
            "voice_settings": self._voice_settings(speed),
        }).encode("utf-8")
        request = urllib.request.Request(url, data=payload, method="POST")
        # Header only. Never a query parameter -- URLs end up in logs and
        # proxies, and this one must not.
        request.add_header("xi-api-key", self._api_key)
        request.add_header("content-type", "application/json")
        request.add_header("accept", "audio/*")
        return urllib.request.urlopen(request, timeout=self.connect_timeout)

    def _redact(self, value: Any) -> str:
        text = str(value)
        if self._api_key:
            text = text.replace(self._api_key, "<redacted>")
        return text[:300]

    def _describe_http_error(self, exc: "urllib.error.HTTPError") -> str:
        detail = ""
        try:
            body = exc.read().decode("utf-8", "replace")
            parsed = json.loads(body)
            status = parsed.get("detail")
            if isinstance(status, dict):
                detail = str(status.get("status") or status.get("message") or "")
            elif status:
                detail = str(status)
            if not detail:
                detail = body
        except Exception:  # noqa: BLE001 - error reporting must not raise
            detail = ""
        message = f"http {exc.code}"
        if detail:
            message = f"{message} {detail}"
        return self._redact(message)

    # -- synthesis --------------------------------------------------------

    def stream(
        self,
        text: str,
        voice: str,
        speed: float,
        cancel: threading.Event,
    ) -> Iterable[bytes]:
        if cancel.is_set():
            raise Cancelled("cancelled before synthesis")

        voice_id = elevenlabs_voice_id(voice, self.voice_id)
        try:
            response = self._opener(text, voice_id, speed)
        except urllib.error.HTTPError as exc:
            raise EngineError(f"elevenlabs {self._describe_http_error(exc)}") from None
        except Exception as exc:  # noqa: BLE001 - any transport failure degrades
            raise EngineError(f"elevenlabs request failed: {self._redact(exc)}") from None

        # The body is read on its own thread so a cancel (barge-in) is noticed
        # within a poll interval instead of after a socket timeout, and so a
        # server that simply stops sending cannot wedge the synthesis lock.
        inbox: "queue.Queue[Any]" = queue.Queue(maxsize=64)

        def pump() -> None:
            try:
                while True:
                    data = response.read(4096)
                    if not data:
                        inbox.put(_STREAM_DONE, timeout=5)
                        return
                    inbox.put(data, timeout=5)
            except BaseException as exc:  # noqa: BLE001 - reported to the consumer
                try:
                    inbox.put(exc, timeout=1)
                except queue.Full:
                    pass

        reader = threading.Thread(target=pump, name="orion-eleven-read", daemon=True)
        reader.start()

        pending = bytearray()
        emitted = 0
        first_bytes = segment_bytes(self.sample_rate, self.first_segment_ms)
        later_bytes = segment_bytes(self.sample_rate, self.segment_ms)
        deadline = time.monotonic() + self.stall_timeout
        try:
            while True:
                if cancel.is_set():
                    raise Cancelled("cancelled mid-stream")
                try:
                    item = inbox.get(timeout=0.05)
                except queue.Empty:
                    if time.monotonic() > deadline:
                        raise EngineError(
                            f"elevenlabs stopped sending after {self.stall_timeout:.0f}s"
                        )
                    continue
                deadline = time.monotonic() + self.stall_timeout
                if item is _STREAM_DONE:
                    break
                if isinstance(item, BaseException):
                    if isinstance(item, urllib.error.HTTPError):
                        raise EngineError(
                            f"elevenlabs {self._describe_http_error(item)}"
                        ) from None
                    raise EngineError(
                        f"elevenlabs stream failed: {self._redact(item)}"
                    ) from None

                pending += item
                want = first_bytes if emitted == 0 else later_bytes
                take = emit_length(len(pending), want)
                if take:
                    yield wav_bytes_from_pcm(bytes(pending[:take]), self.sample_rate)
                    del pending[:take]
                    emitted += 1

            tail = emit_length(len(pending), 1)
            if tail:
                yield wav_bytes_from_pcm(bytes(pending[:tail]), self.sample_rate)
                emitted += 1
            if emitted == 0:
                raise EngineError("elevenlabs returned no audio")
        finally:
            # Closing the body is what unblocks the reader thread, so this runs
            # on every exit -- normal, cancelled, or failed.
            try:
                response.close()
            except Exception:  # noqa: BLE001
                pass

    def synth(
        self,
        text: str,
        voice: str,
        speed: float,
        cancel: threading.Event,
    ) -> bytes:
        blobs = list(self.stream(text, voice, speed, cancel))
        if not blobs:
            raise EngineError("elevenlabs returned no audio")
        return join_wav_bytes(blobs)


class LocalFallbackEngine(Engine):
    """The local voice, built on first use, with /usr/bin/say as the floor.

    When ElevenLabs is the primary voice there is no reason to pay the MLX model
    load before anything needs it -- but a network blip must not drop Orion to
    robot-voice for the rest of the session either. So the first fallback builds
    the real local engine and every later one reuses it. `prewarm()` does that
    build on a background thread at startup, which makes the first fallback as
    fast as every other one.
    """

    name = "local"

    def __init__(
        self,
        config: "Config",
        builder: Optional[Callable[["Config"], Engine]] = None,
    ) -> None:
        self.config = config
        self._builder = builder or build_local_engine
        self._engine: Optional[Engine] = None
        self._floor = SayEngine(config.sample_rate)
        self._lock = threading.Lock()

    @property
    def resolved_name(self) -> str:
        engine = self._engine
        return engine.name if engine is not None else "local:not-yet-built"

    def resolve(self) -> Engine:
        with self._lock:
            if self._engine is None:
                started = time.monotonic()
                try:
                    self._engine = self._builder(self.config)
                except Exception as exc:  # noqa: BLE001 - degrade, never die
                    log(f"local fallback unavailable: {exc}", level="warn")
                    self._engine = self._floor
                else:
                    elapsed = int((time.monotonic() - started) * 1000)
                    log(f"local fallback ready engine={self._engine.name} ms={elapsed}")
            return self._engine

    def prewarm(self) -> None:
        threading.Thread(
            target=self.resolve, name="orion-local-prewarm", daemon=True
        ).start()

    def synth(
        self,
        text: str,
        voice: str,
        speed: float,
        cancel: threading.Event,
    ) -> bytes:
        engine = self.resolve()
        try:
            return engine.synth(text, voice, speed, cancel)
        except Cancelled:
            raise
        except Exception as exc:  # noqa: BLE001
            if engine is self._floor:
                raise
            log(f"local engine {engine.name} failed: {exc}", level="warn")
            return self._floor.synth(text, voice, speed, cancel)


def _find_wav(directory: str, prefix: str) -> Optional[str]:
    try:
        names = sorted(os.listdir(directory))
    except OSError:
        return None
    matching = [n for n in names if n.startswith(prefix) and n.lower().endswith(".wav")]
    if matching:
        return os.path.join(directory, matching[0])
    any_wav = [n for n in names if n.lower().endswith(".wav")]
    if any_wav:
        return os.path.join(directory, any_wav[0])
    return None


# Provider names. `local` covers the whole MLX -> say chain; the daemon does not
# make the caller care which rung of it answered.
PROVIDER_CLOUD = "elevenlabs"
PROVIDER_LOCAL = "local"

_CLOUD_ALIASES = frozenset({"elevenlabs", "eleven", "11labs", "cloud"})
_LOCAL_ALIASES = frozenset({
    "local", "mlx", "mlx-warm", "mlx-generate-fn", "mlx-cli", "say", "offline",
})


def resolve_provider(pref: str, cloud_available: bool, opted_in: bool) -> str:
    """Decide which voice serves. Pure, because this is the decision that has
    to be right and has to be checkable without a network or a model.

    - An explicit `elevenlabs` preference uses the cloud voice IF a key was
      found. Asking for it without a key does not fail the request; it resolves
      to local and the daemon says so in the log.
    - `auto` only reaches for the cloud voice when the user has opted in AND a
      key is present. Silence-by-default is deliberate: nobody should discover
      they enabled a paid network call by accident.
    - Anything else is local.
    """
    choice = (pref or "auto").strip().lower()
    if choice in _CLOUD_ALIASES:
        return PROVIDER_CLOUD if cloud_available else PROVIDER_LOCAL
    if choice in ("auto", ""):
        return PROVIDER_CLOUD if (cloud_available and opted_in) else PROVIDER_LOCAL
    return PROVIDER_LOCAL


def build_local_engine(config: Config) -> Engine:
    """Pick the best available LOCAL engine, best first, `say` as the floor."""
    pref = config.engine_pref

    if pref == "say":
        log("engine forced to say", level="warn")
        return SayEngine(config.sample_rate)

    if pref in ("auto", "local", "mlx", "mlx-warm", PROVIDER_CLOUD, "eleven",
                "11labs", "cloud"):
        started = time.monotonic()
        try:
            engine = MlxWarmEngine(config.model_path, config.sample_rate)
            elapsed = int((time.monotonic() - started) * 1000)
            log(f"engine=mlx-warm model_load_ms={elapsed} model={config.model_path}")
            return engine
        except Exception as exc:  # noqa: BLE001 - degrade, never die
            log(f"mlx-warm unavailable: {exc}", level="warn")

    if pref in ("auto", "local", "mlx-generate-fn", PROVIDER_CLOUD, "eleven",
                "11labs", "cloud"):
        try:
            engine = MlxGenerateFnEngine(config.model_path)
            log("engine=mlx-generate-fn (model reload per chunk)", level="warn")
            return engine
        except Exception as exc:  # noqa: BLE001
            log(f"mlx-generate-fn unavailable: {exc}", level="warn")

    if pref in ("auto", "local", "mlx-cli", PROVIDER_CLOUD, "eleven", "11labs",
                "cloud") and os.access(config.mlx_cli, os.X_OK):
        log("engine=mlx-cli (cold model load per chunk)", level="warn")
        return MlxCliEngine(config.mlx_cli, config.model_path)

    log("falling back to /usr/bin/say -- voice quality degraded", level="warn")
    return SayEngine(config.sample_rate)


def build_cloud_engine(config: Config) -> Optional[Engine]:
    """The ElevenLabs engine, or None with a reason in the log.

    Never raises: a missing key or a bad voice id must not stop the daemon from
    starting, it must just leave Orion on the local voice.
    """
    if not config.eleven_api_key:
        return None
    try:
        engine = ElevenLabsEngine(config, config.eleven_api_key)
    except Exception as exc:  # noqa: BLE001 - degrade, never die
        log(f"elevenlabs unavailable: {exc}", level="warn")
        return None
    described = engine.describe()
    log(
        "elevenlabs ready "
        f"model={described['model']} voice={described['voice_id']} "
        f"format={described['output_format']}"
    )
    return engine


def build_engine(config: Config) -> Engine:
    """The engine that serves by default. Kept for callers that want one engine.

    `build_stack` is the richer entry point; this stays so `--selftest` and the
    existing tests keep a one-call way to ask "what will speak?".
    """
    cloud, local, provider = build_stack(config)
    return cloud if provider == PROVIDER_CLOUD and cloud is not None else local


def build_stack(config: Config) -> tuple[Optional[Engine], Engine, str]:
    """Return (cloud engine or None, local engine, the provider that serves).

    Both engines exist up front when the cloud voice is in play, so the user can
    flip providers in Preferences and have the very next reply honour it without
    restarting the daemon. The local one is lazy: it is a several-second model
    load that should not be paid until something needs it.
    """
    cloud = build_cloud_engine(config)
    provider = resolve_provider(
        config.engine_pref, cloud is not None, config.eleven_opt_in
    )
    if provider == PROVIDER_CLOUD:
        local: Engine = LocalFallbackEngine(config)
    else:
        local = build_local_engine(config)
        if cloud is not None:
            log(
                "elevenlabs key found but not selected "
                f"(ORION_TTS_ENGINE={config.engine_pref}, "
                f"ORION_TTS_CLOUD_VOICE={'1' if config.eleven_opt_in else '0'})"
            )
    log(f"voice provider={provider}")
    return cloud, local, provider


# --------------------------------------------------------------------------
# Job bookkeeping
# --------------------------------------------------------------------------


class Job:
    def __init__(self, job_id: str, text: str) -> None:
        self.id = job_id
        self.text = text
        self.cancel = threading.Event()
        self.created = time.monotonic()


class Registry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, Job] = {}

    def add(self, job: Job) -> None:
        with self._lock:
            self._jobs[job.id] = job

    def remove(self, job_id: str) -> None:
        with self._lock:
            self._jobs.pop(job_id, None)

    def cancel(self, job_id: Optional[str] = None) -> list[str]:
        with self._lock:
            targets = (
                [self._jobs[job_id]] if job_id and job_id in self._jobs
                else list(self._jobs.values()) if job_id is None
                else []
            )
            for job in targets:
                job.cancel.set()
            return [job.id for job in targets]

    def cancel_others(self, keep_id: str) -> list[str]:
        with self._lock:
            cancelled = []
            for job in self._jobs.values():
                if job.id != keep_id:
                    job.cancel.set()
                    cancelled.append(job.id)
            return cancelled

    def active(self) -> int:
        with self._lock:
            return len(self._jobs)


class ChunkCache:
    """Tiny LRU over (text, voice, speed) -> wav bytes.

    Short acknowledgements ("Yes.", "Done.", "I'm listening.") repeat constantly
    in a voice loop; serving them from memory is effectively free.
    """

    def __init__(self, capacity: int) -> None:
        self.capacity = capacity
        self._lock = threading.Lock()
        self._data: OrderedDict[tuple[str, str, str], bytes] = OrderedDict()
        self.hits = 0
        self.misses = 0

    @staticmethod
    def _key(text: str, voice: str, speed: float) -> tuple[str, str, str]:
        return (text, voice, f"{speed:.3f}")

    def get(self, text: str, voice: str, speed: float) -> Optional[bytes]:
        if self.capacity <= 0:
            return None
        key = self._key(text, voice, speed)
        with self._lock:
            if key in self._data:
                self._data.move_to_end(key)
                self.hits += 1
                return self._data[key]
            self.misses += 1
            return None

    def put(self, text: str, voice: str, speed: float, data: bytes) -> None:
        if self.capacity <= 0:
            return
        key = self._key(text, voice, speed)
        with self._lock:
            self._data[key] = data
            self._data.move_to_end(key)
            while len(self._data) > self.capacity:
                self._data.popitem(last=False)


class Stats:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.started = time.monotonic()
        self.served = 0
        self.failed = 0
        self.cancelled = 0
        self.total_ms = 0
        self.first_chunk_ms_total = 0
        self.first_chunk_samples = 0

    def record(self, total_ms: int, first_ms: Optional[int]) -> None:
        with self.lock:
            self.served += 1
            self.total_ms += total_ms
            if first_ms is not None:
                self.first_chunk_ms_total += first_ms
                self.first_chunk_samples += 1

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            avg_total = self.total_ms // self.served if self.served else 0
            avg_first = (
                self.first_chunk_ms_total // self.first_chunk_samples
                if self.first_chunk_samples
                else 0
            )
            return {
                "uptime_s": int(time.monotonic() - self.started),
                "served": self.served,
                "failed": self.failed,
                "cancelled": self.cancelled,
                "avg_total_ms": avg_total,
                "avg_first_chunk_ms": avg_first,
            }


# --------------------------------------------------------------------------
# Synthesizer
# --------------------------------------------------------------------------


class Synthesizer:
    def __init__(
        self,
        config: Config,
        engine: Engine,
        cloud: Optional[Engine] = None,
        local: Optional[Engine] = None,
    ) -> None:
        self.config = config
        # `engine` is what serves unless a request asks for something else.
        self.engine = engine
        self.cloud = cloud
        self.local = local if local is not None else (
            None if cloud is not None and engine is cloud else engine
        )
        if self.local is None:
            self.local = LocalFallbackEngine(config)
        self.default_provider = (
            PROVIDER_CLOUD if cloud is not None and engine is cloud else PROVIDER_LOCAL
        )
        # The floor. Local engines fall back to `say`; the cloud engine falls
        # back to the whole local chain, because dropping from a studio voice
        # straight to `say` over one dropped packet would be absurd.
        self.fallback = self.local if self.default_provider == PROVIDER_CLOUD \
            else SayEngine(config.sample_rate)
        # What ACTUALLY served last, after any fallback. Reported by `status`
        # and by orion-doctor, because a silent degradation already cost an
        # afternoon once.
        self.served_by = engine.name
        self.served_counts: dict[str, int] = {}
        self.cache = ChunkCache(config.cache_entries)
        self.registry = Registry()
        self.stats = Stats()
        # MLX is not safely re-entrant and the GPU serialises anyway, so one
        # synthesis at a time. The semaphore is the bounded queue in front.
        self._lock = threading.Lock()
        self._slots = threading.BoundedSemaphore(config.queue_max)

    # -- provider selection ----------------------------------------------

    def engine_for(self, requested: Optional[str]) -> tuple[Engine, str]:
        """Resolve one request's voice provider to a concrete engine."""
        if not requested:
            return self.engine, self.default_provider
        provider = resolve_provider(requested, self.cloud is not None, True)
        if provider == PROVIDER_CLOUD and self.cloud is not None:
            return self.cloud, PROVIDER_CLOUD
        assert self.local is not None
        return self.local, PROVIDER_LOCAL

    def fallback_for(self, engine: Engine) -> Engine:
        if self.cloud is not None and engine is self.cloud:
            assert self.local is not None
            return self.local
        return self.fallback

    def _record(self, name: str) -> None:
        self.served_by = name
        with self.stats.lock:
            self.served_counts[name] = self.served_counts.get(name, 0) + 1

    def provider_status(self) -> dict[str, Any]:
        """Presence and identity only. Never a key, never any part of one."""
        local = self.local
        status: dict[str, Any] = {
            "tts_configured": self.config.engine_pref,
            "tts_default": self.default_provider,
            "tts_active": self.served_by,
            "tts_fallback": (
                local.resolved_name if isinstance(local, LocalFallbackEngine)
                else (local.name if local is not None else self.fallback.name)
            ),
            "elevenlabs_key_present": bool(self.config.eleven_api_key),
            "elevenlabs_available": self.cloud is not None,
            "elevenlabs_opt_in": self.config.eleven_opt_in,
            "served_counts": dict(self.served_counts),
        }
        if isinstance(self.cloud, ElevenLabsEngine):
            status["elevenlabs"] = self.cloud.describe()
        return status

    # -- chunk level -----------------------------------------------------

    def _stream_chunk(
        self,
        text: str,
        voice: str,
        speed: float,
        cancel: threading.Event,
        engine: Optional[Engine] = None,
        used: Optional[list[str]] = None,
    ) -> Iterable[tuple[bytes, bool]]:
        """Yield (wav_bytes, was_cached) for one text chunk, earliest first.

        Local engines produce the whole chunk in one piece. A network engine
        yields several, so the first one can be on its way to the speakers while
        the rest of the sentence is still arriving.

        Fallback rule: if the engine fails BEFORE any audio was handed out, the
        chunk is re-synthesised on the fallback engine and the listener hears
        nothing unusual. If it fails AFTER, the partial audio has already been
        played, so re-speaking it would stutter -- the chunk ends there and the
        failure is logged.
        """
        engine = engine or self.engine
        fallback = self.fallback_for(engine)
        # The cache is keyed per engine as well as per voice. Without that, a
        # short acknowledgement synthesised by ElevenLabs would be replayed in
        # the cloud voice after the user switched back to the local one.
        key_voice = f"{engine.name}:{voice}"

        cached = self.cache.get(text, key_voice, speed)
        if cached is not None:
            self._record(engine.name)
            if used is not None:
                used.append(engine.name)
            yield cached, True
            return

        blobs: list[bytes] = []
        try:
            for blob in engine.stream(text, voice, speed, cancel):
                blobs.append(blob)
                yield blob, False
        except Cancelled:
            raise
        except Exception as exc:  # noqa: BLE001 - degrade, never go silent
            if blobs:
                log(
                    f"engine {engine.name} failed after {len(blobs)} segment(s), "
                    f"keeping the partial chunk: {exc}",
                    level="warn",
                )
                self._record(engine.name)
                if used is not None:
                    used.append(engine.name)
                return
            log(
                f"engine {engine.name} failed: {exc} -- "
                f"falling back to {fallback.name}",
                level="warn",
            )
            data = fallback.synth(text, voice, speed, cancel)
            served = (
                fallback.resolved_name
                if isinstance(fallback, LocalFallbackEngine) else fallback.name
            )
            self._record(served)
            if used is not None:
                used.append(served)
            self.cache.put(text, f"{served}:{voice}", speed, data)
            yield data, False
            return

        if blobs:
            self._record(engine.name)
            if used is not None:
                used.append(engine.name)
            self.cache.put(
                text, key_voice, speed,
                blobs[0] if len(blobs) == 1 else join_wav_bytes(blobs),
            )

    def _synth_chunk(
        self,
        text: str,
        voice: str,
        speed: float,
        cancel: threading.Event,
        engine: Optional[Engine] = None,
    ) -> tuple[bytes, bool]:
        """Return (wav_bytes, was_cached) for one chunk, all of it."""
        blobs: list[bytes] = []
        cached = False
        for blob, was_cached in self._stream_chunk(text, voice, speed, cancel, engine):
            blobs.append(blob)
            cached = cached or was_cached
        if not blobs:
            raise EngineError("engine produced no audio")
        return (blobs[0] if len(blobs) == 1 else join_wav_bytes(blobs)), cached


    # -- request level ---------------------------------------------------

    def run(
        self,
        request: dict[str, Any],
        emit: Callable[[dict[str, Any]], None],
    ) -> None:
        job_id = str(request.get("id") or f"job-{uuid.uuid4().hex[:10]}")
        text = spoken_times(str(request.get("text") or ""))
        mode = str(request.get("mode") or "file").lower()
        voice = str(request.get("voice") or self.config.voice)
        speed = float(request.get("speed") or self.config.speed)
        encode = str(request.get("encode") or "path").lower()
        output = request.get("output")
        play = bool(request.get("play"))
        preempt = bool(request.get("preempt"))
        allow_partial = bool(request.get("allow_partial"))
        # Which voice serves this reply. Absent => the daemon's default, so an
        # old client keeps behaving exactly as it did.
        requested_provider = request.get("provider") or request.get("engine")
        deadline_ms = request.get("deadline_ms")
        deadline_at = (
            time.monotonic() + float(deadline_ms) / 1000.0
            if isinstance(deadline_ms, (int, float)) and deadline_ms > 0
            else None
        )

        if not text.strip():
            emit({"ok": False, "id": job_id, "code": "empty_text",
                  "error": "text is empty"})
            return
        if mode == "file" and not output:
            emit({"ok": False, "id": job_id, "code": "no_output",
                  "error": "file mode requires 'output'"})
            return

        if not self._slots.acquire(blocking=False):
            emit({"ok": False, "id": job_id, "code": "queue_full",
                  "error": f"queue full ({self.config.queue_max})"})
            return

        job = Job(job_id, text)
        self.registry.add(job)
        if preempt:
            killed = self.registry.cancel_others(job_id)
            if killed:
                log(f"{job_id}: preempted {len(killed)} job(s) for barge-in")

        started = time.monotonic()
        try:
            self._run_locked(
                job, emit,
                mode=mode, voice=voice, speed=speed, encode=encode,
                output=output, play=play, allow_partial=allow_partial,
                deadline_at=deadline_at, started=started,
                provider=str(requested_provider) if requested_provider else None,
            )
        except Cancelled as exc:
            with self.stats.lock:
                self.stats.cancelled += 1
            emit({"ok": False, "id": job_id, "code": "cancelled",
                  "error": str(exc)})
        except Exception as exc:  # noqa: BLE001 - always answer the client
            with self.stats.lock:
                self.stats.failed += 1
            log(f"{job_id}: failed: {exc}", level="error")
            emit({"ok": False, "id": job_id, "code": "error", "error": str(exc)})
        finally:
            self.registry.remove(job_id)
            self._slots.release()

    def _run_locked(
        self,
        job: Job,
        emit: Callable[[dict[str, Any]], None],
        *,
        mode: str,
        voice: str,
        speed: float,
        encode: str,
        output: Optional[str],
        play: bool,
        allow_partial: bool,
        deadline_at: Optional[float],
        started: float,
        provider: Optional[str] = None,
    ) -> None:
        engine, provider_name = self.engine_for(provider)
        used: list[str] = []
        if getattr(engine, "streams_natively", False):
            # One request, one continuous utterance, no seams to hear.
            chunks = [job.text.strip()] if job.text.strip() else []
        else:
            chunks = chunk_text(
                job.text,
                first_max=self.config.first_chunk_chars,
                max_chars=self.config.chunk_chars,
            )
        if not chunks:
            raise EngineError("nothing to synthesize after chunking")

        wait_timeout = -1.0
        if deadline_at is not None:
            wait_timeout = max(0.05, deadline_at - time.monotonic())
        acquired = self._lock.acquire(timeout=wait_timeout)
        if not acquired:
            raise EngineError("busy: timed out waiting for the synthesis lock")

        chunk_dir: Optional[str] = None
        player: Optional[_Player] = None
        try:
            if job.cancel.is_set():
                raise Cancelled("cancelled while queued")
            if mode == "stream" and encode == "path":
                chunk_dir = os.path.join(self.config.runtime_dir, job.id)
                os.makedirs(chunk_dir, exist_ok=True)
            if play:
                player = _Player(self.config.play_cmd, job.cancel)

            blobs: list[bytes] = []
            cached_count = 0
            first_chunk_ms: Optional[int] = None
            truncated = False
            # Frames are counted, not chunks: a network engine hands back a
            # sentence in several pieces and each one is playable on arrival.
            frame_index = 0

            for index, chunk in enumerate(chunks):
                if job.cancel.is_set():
                    raise Cancelled("cancelled mid-request")
                if deadline_at is not None and time.monotonic() > deadline_at:
                    if allow_partial and blobs:
                        truncated = True
                        log(f"{job.id}: deadline hit, returning "
                            f"{index}/{len(chunks)} chunks", level="warn")
                        break
                    raise EngineError("deadline exceeded before completion")

                chunk_started = time.monotonic()
                for data, was_cached in self._stream_chunk(
                    chunk, voice, speed, job.cancel, engine, used
                ):
                    elapsed = int((time.monotonic() - chunk_started) * 1000)
                    if frame_index == 0:
                        first_chunk_ms = elapsed
                    if was_cached:
                        cached_count += 1
                    blobs.append(data)

                    if player is not None:
                        player.enqueue(data)

                    if mode == "stream":
                        frame: dict[str, Any] = {
                            "event": "chunk",
                            "id": job.id,
                            "index": frame_index,
                            "total": len(chunks),
                            "chunk": index,
                            "text": chunk,
                            "ms": elapsed,
                            "cached": was_cached,
                            "duration_ms": wav_duration_ms(data),
                        }
                        if encode == "base64":
                            frame["audio_b64"] = base64.b64encode(data).decode("ascii")
                        else:
                            assert chunk_dir is not None
                            path = os.path.join(
                                chunk_dir, f"chunk_{frame_index:03d}.wav"
                            )
                            _atomic_write(path, data)
                            frame["path"] = path
                        emit(frame)
                    frame_index += 1

            total_ms = int((time.monotonic() - started) * 1000)
            self.stats.record(total_ms, first_chunk_ms)
            served = used[-1] if used else engine.name
            engines = sorted(set(used))

            if mode == "stream":
                if player is not None:
                    player.finish()
                log(
                    f"{job.id}: ok provider={provider_name} engine={served} "
                    f"frames={len(blobs)} cached={cached_count} "
                    f"first_ms={first_chunk_ms} total_ms={total_ms} "
                    f"text=\"{preview(job.text)}\""
                )
                emit({
                    "event": "done", "ok": True, "id": job.id,
                    "chunks": len(blobs), "ms": total_ms,
                    "first_chunk_ms": first_chunk_ms,
                    "engine": served,
                    "engines": engines,
                    "provider": provider_name,
                    "cached_chunks": cached_count,
                    "truncated": truncated,
                    **({"dir": chunk_dir} if chunk_dir else {}),
                })
                return

            # The gap exists to stop the local model's separately-synthesised
            # sentences running into each other. An engine that produced the
            # whole utterance in one pass has no seams, so inserting silence
            # into it only chops up speech that was already continuous.
            gap = 0 if getattr(engine, "streams_natively", False) else self.config.gap_ms
            joined = join_wav_bytes(blobs, gap_ms=gap)
            assert output is not None
            _atomic_write(output, joined)
            if player is not None:
                player.finish()
            log(
                f"{job.id}: ok provider={provider_name} engine={served} "
                f"chunks={len(blobs)} cached={cached_count} "
                f"first_ms={first_chunk_ms} total_ms={total_ms} "
                f"text=\"{preview(job.text)}\""
            )
            emit({
                "ok": True, "id": job.id, "output": output,
                "engine": served, "engines": engines,
                "provider": provider_name, "chunks": len(blobs),
                "cached_chunks": cached_count, "ms": total_ms,
                "first_chunk_ms": first_chunk_ms,
                "duration_ms": wav_duration_ms(joined),
                "truncated": truncated,
            })
        finally:
            if player is not None:
                player.stop()
            self._lock.release()

    # -- warmup ----------------------------------------------------------

    def warmup(self) -> None:
        if not self.config.warmup:
            return
        if self.default_provider == PROVIDER_CLOUD:
            # Nothing to warm: there is no model to load, and a warmup call
            # would be a billed request on every daemon start. Build the local
            # fallback in the background instead, so the first network failure
            # does not also pay a model load.
            local = self.local
            if isinstance(local, LocalFallbackEngine):
                local.prewarm()
            log(f"warmup skipped engine={self.engine.name} (no local model to load)")
            return
        started = time.monotonic()
        cancel = threading.Event()
        try:
            self.engine.synth(
                self.config.warmup_text, self.config.voice, self.config.speed, cancel
            )
        except Exception as exc:  # noqa: BLE001
            log(f"warmup failed on {self.engine.name}: {exc}", level="warn")
            if not isinstance(self.engine, SayEngine):
                log("demoting to /usr/bin/say after warmup failure", level="warn")
                self.engine = SayEngine(self.config.sample_rate)
                self.local = self.engine
                self.served_by = self.engine.name
            return
        elapsed = int((time.monotonic() - started) * 1000)
        self.served_by = self.engine.name
        log(f"warmup ok engine={self.engine.name} ms={elapsed}")


def _atomic_write(path: str, data: bytes) -> None:
    """Write `data` to `path` atomically.

    The temp file deliberately does NOT use an audio extension: OpenClaw's
    tts-local-cli provider scans the output directory for any audio file and
    would otherwise be able to pick up a half-written one.
    """
    directory = os.path.dirname(os.path.abspath(path)) or "."
    os.makedirs(directory, exist_ok=True)
    handle, temp_path = tempfile.mkstemp(
        prefix=".orion-tts-", suffix=".partial", dir=directory
    )
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_path, path)
    except BaseException:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


class _Player:
    """Sequential, cancellable playback of chunk audio by the daemon itself.

    Used by `mode: "stream", play: true`. This is the only path that can hit a
    sub-300ms time-to-first-audio locally, because it starts playing chunk 0
    while later chunks are still being synthesized.
    """

    def __init__(self, play_cmd: str, cancel: threading.Event) -> None:
        self.play_cmd = play_cmd
        self.cancel = cancel
        self._queue: list[bytes] = []
        self._condition = threading.Condition()
        self._done = False
        self._drained = False
        self._proc: Optional[subprocess.Popen[bytes]] = None
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def enqueue(self, data: bytes) -> None:
        with self._condition:
            self._queue.append(data)
            self._condition.notify()

    def finish(self) -> None:
        with self._condition:
            self._done = True
            self._condition.notify()
        self._thread.join(timeout=120)
        self._drained = True

    def stop(self) -> None:
        # `stop()` runs unconditionally in the caller's `finally`. If playback
        # already drained cleanly this must not set the job's cancel flag,
        # which is shared with the synthesis path.
        if self._drained:
            return
        self.cancel.set()
        with self._condition:
            self._done = True
            self._condition.notify()
        proc = self._proc
        if proc is not None and proc.poll() is None:
            try:
                proc.kill()
            except OSError:
                pass

    def _loop(self) -> None:
        while True:
            with self._condition:
                while not self._queue and not self._done and not self.cancel.is_set():
                    self._condition.wait(timeout=0.25)
                if self.cancel.is_set():
                    return
                if not self._queue:
                    if self._done:
                        return
                    continue
                data = self._queue.pop(0)
            self._play(data)
            if self.cancel.is_set():
                return

    def _play(self, data: bytes) -> None:
        handle, path = tempfile.mkstemp(prefix="orion-tts-play-", suffix=".wav")
        try:
            with os.fdopen(handle, "wb") as stream:
                stream.write(data)
            self._proc = subprocess.Popen(
                [self.play_cmd, path],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            self._proc.wait()
        except OSError as exc:
            log(f"playback failed: {exc}", level="warn")
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass


# --------------------------------------------------------------------------
# Server
# --------------------------------------------------------------------------


class Server:
    def __init__(self, config: Config, synth: Synthesizer) -> None:
        self.config = config
        self.synth = synth
        self.stop_event = threading.Event()
        self._listeners: list[socket.socket] = []

    # -- lifecycle -------------------------------------------------------

    def serve_forever(self) -> None:
        unix_sock = self._bind_unix()
        self._listeners.append(unix_sock)
        threads = [threading.Thread(target=self._accept_loop, args=(unix_sock,),
                                    daemon=True)]

        if self.config.tcp_port > 0:
            tcp_sock = self._bind_tcp()
            self._listeners.append(tcp_sock)
            threads.append(threading.Thread(target=self._accept_loop,
                                            args=(tcp_sock,), daemon=True))

        janitor = threading.Thread(target=self._janitor, daemon=True)
        threads.append(janitor)
        for thread in threads:
            thread.start()

        log("ready")
        try:
            while not self.stop_event.wait(0.5):
                pass
        finally:
            self.shutdown()

    def _bind_unix(self) -> socket.socket:
        path = self.config.socket_path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if os.path.exists(path):
            if _probe(path):
                raise SystemExit(f"another orion-tts daemon owns {path}")
            log(f"removing stale socket {path}", level="warn")
            os.unlink(path)
        # Bind to a staging path and move it into place only once the socket is
        # actually accepting. bind() creates the file immediately, so a client
        # that polls for the path can otherwise connect in the window before
        # listen() and get ECONNREFUSED. The rename is atomic and the socket
        # keeps working through it, so the path either accepts or does not
        # exist -- which is exactly what the autostart poll in the client
        # assumes.
        staging = f"{path}.{os.getpid()}.new"
        try:
            os.unlink(staging)
        except OSError:
            pass
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            sock.bind(staging)
            os.chmod(staging, 0o600)
            sock.listen(16)
            sock.settimeout(0.5)
            os.replace(staging, path)
        except BaseException:
            sock.close()
            try:
                os.unlink(staging)
            except OSError:
                pass
            raise
        log(f"listening on unix:{path}")
        return sock

    def _bind_tcp(self) -> socket.socket:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("127.0.0.1", self.config.tcp_port))
        sock.listen(16)
        sock.settimeout(0.5)
        log(f"listening on tcp:127.0.0.1:{self.config.tcp_port}"
            f"{' (token required)' if self.config.tcp_token else ''}")
        return sock

    def shutdown(self) -> None:
        self.stop_event.set()
        for sock in self._listeners:
            try:
                sock.close()
            except OSError:
                pass
        try:
            if os.path.exists(self.config.socket_path):
                os.unlink(self.config.socket_path)
        except OSError:
            pass
        log("stopped")

    # -- connections -----------------------------------------------------

    def _accept_loop(self, listener: socket.socket) -> None:
        while not self.stop_event.is_set():
            try:
                conn, _ = listener.accept()
            except socket.timeout:
                continue
            except OSError as exc:
                if self.stop_event.is_set() or exc.errno in (errno.EBADF, errno.EINVAL):
                    return
                log(f"accept error: {exc}", level="warn")
                continue
            is_tcp = listener.family == socket.AF_INET
            threading.Thread(
                target=self._handle, args=(conn, is_tcp), daemon=True
            ).start()

    def _handle(self, conn: socket.socket, is_tcp: bool) -> None:
        send_lock = threading.Lock()

        def emit(payload: dict[str, Any]) -> None:
            line = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
            with send_lock:
                try:
                    conn.sendall(line)
                except OSError:
                    pass

        try:
            with conn:
                conn.settimeout(600)
                for line in _read_lines(conn):
                    if self.stop_event.is_set():
                        break
                    try:
                        request = json.loads(line)
                    except json.JSONDecodeError as exc:
                        emit({"ok": False, "code": "bad_json", "error": str(exc)})
                        continue
                    if not isinstance(request, dict):
                        emit({"ok": False, "code": "bad_request",
                              "error": "expected a JSON object"})
                        continue
                    if is_tcp and self.config.tcp_token:
                        if request.get("token") != self.config.tcp_token:
                            emit({"ok": False, "code": "unauthorized",
                                  "error": "bad or missing token"})
                            continue
                    self._dispatch(request, emit)
        except OSError:
            pass

    def _dispatch(
        self, request: dict[str, Any], emit: Callable[[dict[str, Any]], None]
    ) -> None:
        op = str(request.get("op") or "synth").lower()

        if op == "ping":
            emit({"ok": True, "pong": True, "engine": self.synth.engine.name,
                  "active_engine": self.synth.served_by, "pid": os.getpid()})
            return
        if op == "status":
            emit({
                "ok": True,
                # `engine` is what is CONFIGURED to serve; `active_engine` is
                # what actually did. They differ exactly when something
                # degraded, which is the thing worth surfacing.
                "engine": self.synth.engine.name,
                "active_engine": self.synth.served_by,
                "providers": self.synth.provider_status(),
                "model": self.config.model_path,
                "voice": self.config.voice,
                "speed": self.config.speed,
                "queue_max": self.config.queue_max,
                "active_jobs": self.synth.registry.active(),
                "cache": {
                    "capacity": self.synth.cache.capacity,
                    "hits": self.synth.cache.hits,
                    "misses": self.synth.cache.misses,
                },
                "pid": os.getpid(),
                **self.synth.stats.snapshot(),
            })
            return
        if op == "cancel":
            job_id = request.get("id")
            cancelled = self.synth.registry.cancel(
                str(job_id) if job_id else None
            )
            log(f"cancel -> {len(cancelled)} job(s)")
            emit({"ok": True, "cancelled": cancelled})
            return
        if op == "cleanup":
            removed = self._sweep_chunks(force=True)
            emit({"ok": True, "removed": removed})
            return
        if op == "shutdown":
            emit({"ok": True, "shutting_down": True})
            self.stop_event.set()
            return
        if op == "synth":
            self.synth.run(request, emit)
            return
        emit({"ok": False, "code": "bad_op", "error": f"unknown op {op!r}"})

    # -- housekeeping ----------------------------------------------------

    def _janitor(self) -> None:
        while not self.stop_event.wait(30):
            self._sweep_chunks(force=False)

    def _sweep_chunks(self, force: bool) -> int:
        root = self.config.runtime_dir
        if not os.path.isdir(root):
            return 0
        removed = 0
        cutoff = time.time() - self.config.chunk_ttl_s
        for name in os.listdir(root):
            path = os.path.join(root, name)
            try:
                if not os.path.isdir(path):
                    continue
                if not force and os.path.getmtime(path) > cutoff:
                    continue
                shutil.rmtree(path, ignore_errors=True)
                removed += 1
            except OSError:
                continue
        return removed


def _read_lines(conn: socket.socket) -> Iterable[str]:
    buffer = b""
    while True:
        try:
            data = conn.recv(65536)
        except socket.timeout:
            return
        except OSError:
            return
        if not data:
            break
        buffer += data
        while b"\n" in buffer:
            raw, buffer = buffer.split(b"\n", 1)
            text = raw.decode("utf-8", "replace").strip()
            if text:
                yield text
    tail = buffer.decode("utf-8", "replace").strip()
    if tail:
        yield tail


def _probe(socket_path: str, timeout: float = 0.75) -> bool:
    """True if a live daemon answers `ping` on `socket_path`."""
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout)
            sock.connect(socket_path)
            sock.sendall(b'{"op":"ping"}\n')
            reply = sock.recv(4096)
        return b'"pong"' in reply
    except OSError:
        return False


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------


def _selftest(config: Config) -> int:
    """Load the engine and synthesize a sample, printing a latency breakdown."""
    print(f"model : {config.model_path}")
    print(f"voice : {config.voice}   speed: {config.speed}")
    load_started = time.monotonic()
    engine = build_engine(config)
    load_ms = int((time.monotonic() - load_started) * 1000)
    print(f"engine: {engine.name}  (load {load_ms} ms)")

    synth = Synthesizer(config, engine)
    warm_started = time.monotonic()
    synth.warmup()
    print(f"warmup: {int((time.monotonic() - warm_started) * 1000)} ms")

    sample = (
        "All systems are online. I have finished the review of your calendar "
        "and there is one conflict tomorrow afternoon. Shall I move it?"
    )
    chunks = chunk_text(sample, config.first_chunk_chars, config.chunk_chars)
    print(f"chunks: {len(chunks)}")
    for index, chunk in enumerate(chunks):
        print(f"  [{index}] {len(chunk):3d} chars  {chunk}")

    frames: list[dict[str, Any]] = []
    out_path = os.path.join(tempfile.gettempdir(), "orion-tts-selftest.wav")
    synth.run(
        {"op": "synth", "text": sample, "output": out_path, "id": "selftest"},
        frames.append,
    )
    for frame in frames:
        print(json.dumps(frame, indent=2))
    return 0 if frames and frames[-1].get("ok") else 1


def main(argv: list[str]) -> int:
    _open_log()

    if "--selftest" in argv:
        return _selftest(CONFIG)
    if "--chunk-preview" in argv:
        index = argv.index("--chunk-preview")
        text = argv[index + 1] if len(argv) > index + 1 else sys.stdin.read()
        for i, chunk in enumerate(
            chunk_text(text, CONFIG.first_chunk_chars, CONFIG.chunk_chars)
        ):
            print(f"[{i}] {len(chunk):3d}  {chunk}")
        return 0

    log(
        f"starting pid={os.getpid()} python={sys.version.split()[0]} "
        f"voice={CONFIG.voice} speed={CONFIG.speed}"
    )
    cloud, local, provider = build_stack(CONFIG)
    engine = cloud if provider == PROVIDER_CLOUD and cloud is not None else local
    synth = Synthesizer(CONFIG, engine, cloud=cloud, local=local)
    synth.warmup()

    server = Server(CONFIG, synth)

    def _on_signal(signum: int, _frame: Any) -> None:
        log(f"signal {signum} -> shutting down")
        server.stop_event.set()

    # SIGTERM and SIGINT mean "stop". SIGHUP does not.
    #
    # SIGHUP is what a terminal sends its children when its window closes. This
    # daemon is started from a shell, so treating SIGHUP as shutdown meant
    # Orion lost its voice every single time a Terminal window was closed —
    # which happened repeatedly, and each time looked like a fresh unrelated
    # bug. `nohup` already sets SIGHUP to SIG_IGN; installing a handler for it
    # deliberately undid that protection.
    #
    # For a long-lived daemon SIGHUP conventionally means "reload", never
    # "die". Explicitly ignored so nothing can hang up on Orion.
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sig, _on_signal)
        except (OSError, ValueError):
            pass

    try:
        signal.signal(signal.SIGHUP, signal.SIG_IGN)
    except (OSError, ValueError, AttributeError):
        pass

    server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
