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
import errno
import io
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import wave
from collections import OrderedDict
from typing import Any, Callable, Iterable, Optional

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


class Config:
    """Snapshot of tunables, read once at startup."""

    def __init__(self) -> None:
        self.model_path = _env("ORION_TTS_MODEL", DEFAULT_MODEL)
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
# Synthesis engines
# --------------------------------------------------------------------------


class EngineError(RuntimeError):
    pass


class Cancelled(RuntimeError):
    pass


class Engine:
    name = "base"

    def synth(
        self,
        text: str,
        voice: str,
        speed: float,
        cancel: threading.Event,
    ) -> bytes:
        raise NotImplementedError


class MlxWarmEngine(Engine):
    """The fast path: model loaded once, kept resident, invoked per chunk."""

    name = "mlx-warm"

    def __init__(self, model_path: str, sample_rate: int) -> None:
        self.model_path = model_path
        self.default_sample_rate = sample_rate
        self.model = self._load(model_path)
        self._signature: Optional[dict[str, bool]] = None

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
        return wav_bytes_from_pcm(b"".join(pcm_parts), sample_rate)

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


def build_engine(config: Config) -> Engine:
    """Pick the best available engine, loudest-win first, `say` as the floor."""
    pref = config.engine_pref

    if pref in ("say",):
        log("engine forced to say", level="warn")
        return SayEngine(config.sample_rate)

    if pref in ("auto", "mlx", "mlx-warm"):
        started = time.monotonic()
        try:
            engine = MlxWarmEngine(config.model_path, config.sample_rate)
            elapsed = int((time.monotonic() - started) * 1000)
            log(f"engine=mlx-warm model_load_ms={elapsed} model={config.model_path}")
            return engine
        except Exception as exc:  # noqa: BLE001 - degrade, never die
            log(f"mlx-warm unavailable: {exc}", level="warn")

    if pref in ("auto", "mlx-generate-fn"):
        try:
            engine = MlxGenerateFnEngine(config.model_path)
            log("engine=mlx-generate-fn (model reload per chunk)", level="warn")
            return engine
        except Exception as exc:  # noqa: BLE001
            log(f"mlx-generate-fn unavailable: {exc}", level="warn")

    if pref in ("auto", "mlx-cli") and os.access(config.mlx_cli, os.X_OK):
        log("engine=mlx-cli (cold model load per chunk)", level="warn")
        return MlxCliEngine(config.mlx_cli, config.model_path)

    log("falling back to /usr/bin/say -- voice quality degraded", level="warn")
    return SayEngine(config.sample_rate)


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
    def __init__(self, config: Config, engine: Engine) -> None:
        self.config = config
        self.engine = engine
        self.fallback = SayEngine(config.sample_rate)
        self.cache = ChunkCache(config.cache_entries)
        self.registry = Registry()
        self.stats = Stats()
        # MLX is not safely re-entrant and the GPU serialises anyway, so one
        # synthesis at a time. The semaphore is the bounded queue in front.
        self._lock = threading.Lock()
        self._slots = threading.BoundedSemaphore(config.queue_max)

    # -- chunk level -----------------------------------------------------

    def _synth_chunk(
        self,
        text: str,
        voice: str,
        speed: float,
        cancel: threading.Event,
    ) -> tuple[bytes, bool]:
        """Return (wav_bytes, was_cached)."""
        cached = self.cache.get(text, voice, speed)
        if cached is not None:
            return cached, True
        try:
            data = self.engine.synth(text, voice, speed, cancel)
        except Cancelled:
            raise
        except Exception as exc:  # noqa: BLE001 - degrade to say per chunk
            log(f"engine {self.engine.name} failed: {exc}", level="warn")
            data = self.fallback.synth(text, voice, speed, cancel)
        self.cache.put(text, voice, speed, data)
        return data, False

    # -- request level ---------------------------------------------------

    def run(
        self,
        request: dict[str, Any],
        emit: Callable[[dict[str, Any]], None],
    ) -> None:
        job_id = str(request.get("id") or f"job-{uuid.uuid4().hex[:10]}")
        text = str(request.get("text") or "")
        mode = str(request.get("mode") or "file").lower()
        voice = str(request.get("voice") or self.config.voice)
        speed = float(request.get("speed") or self.config.speed)
        encode = str(request.get("encode") or "path").lower()
        output = request.get("output")
        play = bool(request.get("play"))
        preempt = bool(request.get("preempt"))
        allow_partial = bool(request.get("allow_partial"))
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
    ) -> None:
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

            for index, chunk in enumerate(chunks):
                if job.cancel.is_set():
                    raise Cancelled("cancelled mid-request")
                if deadline_at is not None and time.monotonic() > deadline_at:
                    if allow_partial and blobs:
                        truncated = True
                        log(f"{job.id}: deadline hit, returning "
                            f"{len(blobs)}/{len(chunks)} chunks", level="warn")
                        break
                    raise EngineError("deadline exceeded before completion")

                chunk_started = time.monotonic()
                data, was_cached = self._synth_chunk(chunk, voice, speed, job.cancel)
                elapsed = int((time.monotonic() - chunk_started) * 1000)
                if index == 0:
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
                        "index": index,
                        "total": len(chunks),
                        "text": chunk,
                        "ms": elapsed,
                        "cached": was_cached,
                        "duration_ms": wav_duration_ms(data),
                    }
                    if encode == "base64":
                        frame["audio_b64"] = base64.b64encode(data).decode("ascii")
                    else:
                        assert chunk_dir is not None
                        path = os.path.join(chunk_dir, f"chunk_{index:03d}.wav")
                        _atomic_write(path, data)
                        frame["path"] = path
                    emit(frame)

            total_ms = int((time.monotonic() - started) * 1000)
            self.stats.record(total_ms, first_chunk_ms)

            if mode == "stream":
                if player is not None:
                    player.finish()
                emit({
                    "event": "done", "ok": True, "id": job.id,
                    "chunks": len(blobs), "ms": total_ms,
                    "first_chunk_ms": first_chunk_ms,
                    "engine": self.engine.name,
                    "cached_chunks": cached_count,
                    "truncated": truncated,
                    **({"dir": chunk_dir} if chunk_dir else {}),
                })
                return

            joined = join_wav_bytes(blobs, gap_ms=self.config.gap_ms)
            assert output is not None
            _atomic_write(output, joined)
            if player is not None:
                player.finish()
            log(
                f"{job.id}: ok engine={self.engine.name} chunks={len(blobs)} "
                f"cached={cached_count} first_ms={first_chunk_ms} "
                f"total_ms={total_ms} text=\"{preview(job.text)}\""
            )
            emit({
                "ok": True, "id": job.id, "output": output,
                "engine": self.engine.name, "chunks": len(blobs),
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
            return
        elapsed = int((time.monotonic() - started) * 1000)
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
                  "pid": os.getpid()})
            return
        if op == "status":
            emit({
                "ok": True,
                "engine": self.synth.engine.name,
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
    engine = build_engine(CONFIG)
    synth = Synthesizer(CONFIG, engine)
    synth.warmup()

    server = Server(CONFIG, synth)

    def _on_signal(signum: int, _frame: Any) -> None:
        log(f"signal {signum} -> shutting down")
        server.stop_event.set()

    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        try:
            signal.signal(sig, _on_signal)
        except (OSError, ValueError):
            pass

    server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
