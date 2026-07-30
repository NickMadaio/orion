import { Hologram } from "./hologram.js";

/* ------------------------------------------------------------------ *
 * Elements
 * ------------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);
const els = {
  holo: $("holo"), heard: $("heard"), status: $("status"),
  transcript: $("transcript"), composer: $("composer"), input: $("input"),
  mic: $("mic"), send: $("send"), toggle: $("toggle-transcript"),
  gateway: $("pill-gateway"), voice: $("pill-voice"),
};

const holo = new Hologram(els.holo);
holo.start();

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */
const SESSION = "orion-interface";
let busy = false;
let listening = false;
let audioCtx = null;
let currentSource = null;   // in-flight TTS playback, for barge-in
let micAnalyser = null;
let micStream = null;

function setState(name, text) {
  holo.setState(name);
  if (text !== undefined) {
    els.status.textContent = text;
    els.status.classList.toggle("err", name === "error");
  }
}

function addTurn(who, body, cls) {
  const el = document.createElement("div");
  el.className = `turn ${cls}`;
  el.innerHTML = `<div class="who"></div><div class="body"></div>`;
  el.querySelector(".who").textContent = who;
  el.querySelector(".body").textContent = body;
  els.transcript.append(el);
  els.transcript.scrollTop = els.transcript.scrollHeight;
  return el;
}

/* ------------------------------------------------------------------ *
 * Bridge
 * ------------------------------------------------------------------ */
async function api(path, body) {
  const res = await fetch(path, body ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

async function health() {
  try {
    const h = await api("/api/health");
    els.gateway.dataset.ok = String(!!h.gateway);
    els.voice.dataset.ok = String(!!h.tts);
    els.gateway.lastElementChild.textContent = h.gateway ? "gateway" : "gateway down";
    els.voice.lastElementChild.textContent = h.tts ? (h.tts_warm ? "voice warm" : "voice cold") : "voice down";
    return h;
  } catch {
    els.gateway.dataset.ok = "false";
    els.gateway.lastElementChild.textContent = "bridge down";
    delete els.voice.dataset.ok;
    return null;
  }
}
health();
setInterval(health, 15000);

/* ------------------------------------------------------------------ *
 * Speech out — playback drives the hologram via an AnalyserNode, so the
 * shell is reacting to the actual waveform rather than a fake animation.
 * ------------------------------------------------------------------ */
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function stopSpeaking() {
  if (currentSource) {
    try { currentSource.stop(); } catch {}
    currentSource = null;
  }
}

async function speak(text) {
  if (!text.trim()) return;
  const ctx = ensureAudio();
  let buf;
  try {
    const res = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(await res.text());
    buf = await ctx.decodeAudioData(await res.arrayBuffer());
  } catch (err) {
    console.warn("tts failed", err);
    return;
  }

  stopSpeaking();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.55;
  src.connect(analyser);
  analyser.connect(ctx.destination);
  currentSource = src;

  const bins = new Uint8Array(analyser.frequencyBinCount);
  setState("speaking", "speaking");

  const tick = () => {
    if (currentSource !== src) return;
    analyser.getByteFrequencyData(bins);
    let sum = 0;
    for (let i = 0; i < bins.length; i++) sum += bins[i];
    holo.setLevel(Math.min(1, (sum / bins.length / 255) * 2.4));
    requestAnimationFrame(tick);
  };

  return new Promise((resolve) => {
    src.onended = () => {
      if (currentSource === src) {
        currentSource = null;
        holo.setLevel(0);
        setState("idle", "standing by");
      }
      resolve();
    };
    src.start();
    tick();
  });
}

/* ------------------------------------------------------------------ *
 * Speech in — Web Speech API for streaming interim transcripts (fast and
 * free), plus a live mic analyser so the shell reacts while you talk.
 * ------------------------------------------------------------------ */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null;

if (SR) {
  recog = new SR();
  recog.continuous = false;
  recog.interimResults = true;
  recog.lang = navigator.language || "en-US";

  recog.onresult = (ev) => {
    let finalText = "";
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (interim) {
      els.heard.textContent = interim;
      els.heard.classList.add("interim");
    }
    if (finalText.trim()) {
      els.heard.textContent = finalText;
      els.heard.classList.remove("interim");
      stopListening();
      ask(finalText.trim());
    }
  };

  recog.onerror = (ev) => {
    stopListening();
    if (ev.error === "no-speech") setState("idle", "standing by");
    else setState("error", `mic: ${ev.error}`);
  };

  recog.onend = () => { if (listening) stopListening(); };
} else {
  els.mic.disabled = true;
  els.mic.title = "Speech recognition needs Chrome";
}

async function startMicMeter() {
  try {
    const ctx = ensureAudio();
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const src = ctx.createMediaStreamSource(micStream);
    micAnalyser = ctx.createAnalyser();
    micAnalyser.fftSize = 512;
    micAnalyser.smoothingTimeConstant = 0.6;
    src.connect(micAnalyser);

    const bins = new Uint8Array(micAnalyser.frequencyBinCount);
    const tick = () => {
      if (!micAnalyser) return;
      micAnalyser.getByteFrequencyData(bins);
      let sum = 0;
      for (let i = 0; i < bins.length; i++) sum += bins[i];
      holo.setLevel(Math.min(1, (sum / bins.length / 255) * 3.2));
      requestAnimationFrame(tick);
    };
    tick();
  } catch (err) {
    console.warn("mic meter unavailable", err);
  }
}

function stopMicMeter() {
  micAnalyser = null;
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  holo.setLevel(0);
}

function startListening() {
  if (listening || busy || !recog) return;
  stopSpeaking();               // barge-in: talking over Orion cuts it off
  listening = true;
  els.mic.classList.add("live");
  els.heard.textContent = "";
  els.heard.classList.remove("interim");
  setState("listening", "listening");
  startMicMeter();
  try { recog.start(); } catch {}
}

function stopListening() {
  if (!listening) return;
  listening = false;
  els.mic.classList.remove("live");
  stopMicMeter();
  try { recog.stop(); } catch {}
  if (!busy) setState("idle", "standing by");
}

/* ------------------------------------------------------------------ *
 * Turn
 * ------------------------------------------------------------------ */
async function ask(text) {
  if (busy || !text.trim()) return;
  busy = true;
  els.send.disabled = true;
  addTurn("you", text, "you");
  els.heard.textContent = text;
  els.heard.classList.remove("interim");
  setState("thinking", "thinking");

  const started = performance.now();
  try {
    const res = await api("/api/ask", { text, session: SESSION });
    const reply = (res.reply || "").trim() || "(no reply)";
    const ms = Math.round(performance.now() - started);
    addTurn(`orion · ${ms}ms`, reply, "orion");
    els.heard.textContent = "";
    busy = false;
    els.send.disabled = false;
    await speak(reply);
  } catch (err) {
    addTurn("error", String(err.message || err), "sys");
    setState("error", "failed");
    busy = false;
    els.send.disabled = false;
    setTimeout(() => setState("idle", "standing by"), 2600);
  }
}

/* ------------------------------------------------------------------ *
 * Input wiring
 * ------------------------------------------------------------------ */
els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.input.value.trim();
  if (!text) return;
  els.input.value = "";
  ask(text);
});

// Push-to-talk: hold the button, or hold space anywhere outside the field.
els.mic.addEventListener("pointerdown", (e) => { e.preventDefault(); startListening(); });
els.mic.addEventListener("pointerup", stopListening);
els.mic.addEventListener("pointerleave", () => { if (listening) stopListening(); });

let spaceHeld = false;
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && document.activeElement !== els.input && !spaceHeld) {
    e.preventDefault();
    spaceHeld = true;
    startListening();
  }
  if (e.key === "Escape") {
    stopListening();
    stopSpeaking();
    setState("idle", "standing by");
  }
  if (e.key === "/" && document.activeElement !== els.input) {
    e.preventDefault();
    els.input.focus();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space" && spaceHeld) {
    spaceHeld = false;
    stopListening();
  }
});

els.toggle.addEventListener("click", () => {
  els.transcript.hidden = !els.transcript.hidden;
});
els.transcript.addEventListener("pointerenter", () => els.transcript.classList.remove("dim"));
els.transcript.addEventListener("pointerleave", () => els.transcript.classList.add("dim"));

addTurn("orion", "Interface online. Hold space to talk.", "orion");
