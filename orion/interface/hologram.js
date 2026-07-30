/*
 * ORION — holographic core renderer.
 *
 * A rotating spherical shell of radial filaments, latitude arcs, orbital
 * great-circles and drifting chips, drawn additively so overlapping geometry
 * blooms the way a projected hologram does. Canvas 2D on purpose: no CDN, no
 * WebGL context loss, no dependency that can fail while offline. Orion is
 * local-first; its face should be too.
 *
 * The shell is built once as unit-sphere geometry, then each frame is rotated
 * and projected. Nothing is allocated in the draw loop.
 *
 * States: idle | listening | thinking | speaking | error
 * Drive it with setState(name) and setLevel(0..1) from an AnalyserNode.
 */

const TAU = Math.PI * 2;

/* Warm gold, matching the Age of Ultron projection: a white-hot core falling
 * off through amber to a deep ember at the limb. */
const PALETTE = {
  core: [255, 246, 214],
  hot: [255, 208, 112],
  mid: [255, 158, 38],
  deep: [214, 104, 12],
  cool: [120, 176, 255], // listening tint
  alarm: [255, 92, 64],
};

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const rand = (a, b) => a + Math.random() * (b - a);

function mixRgb(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;

/* Fibonacci sphere: even angular coverage without the pole clustering you get
 * from naive lat/lon sampling. The reference image has no visible pole seam. */
function fibonacciPoint(i, n) {
  const y = 1 - (i / (n - 1)) * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = i * 2.399963229728653; // golden angle
  return [Math.cos(theta) * radius, y, Math.sin(theta) * radius];
}

export class Hologram {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.quality = options.quality || "high";
    this.state = "idle";
    this.level = 0;       // instantaneous audio level, 0..1
    this.smooth = 0;      // smoothed level
    this.energy = 0;      // slow-moving envelope, drives global bloom
    this.spin = 0;
    this.time = 0;
    this.stateT = 0;      // 0..1 transition progress into current state
    this.tint = 0;        // 0 = gold, 1 = state tint
    this.running = false;
    this.lastFrame = 0;
    this.pulse = 0;       // one-shot ripple, fired by ping()

    this.build();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  build() {
    const dense = this.quality === "high";

    // Radial filaments: the dominant texture of the reference image.
    const filamentCount = dense ? 1500 : 620;
    this.filaments = new Array(filamentCount);
    for (let i = 0; i < filamentCount; i++) {
      const [x, y, z] = fibonacciPoint(i, filamentCount);
      // Most filaments hug the shell; a minority spike out, which is what
      // gives the silhouette its ragged, growing-outward feel.
      const spike = Math.random() < 0.14;
      this.filaments[i] = {
        x, y, z,
        inner: spike ? rand(0.55, 0.74) : rand(0.78, 0.93),
        outer: spike ? rand(1.04, 1.22) : rand(0.97, 1.03),
        w: spike ? rand(0.9, 1.7) : rand(0.35, 0.95),
        // Per-filament phase so the shimmer never looks synchronised.
        phase: Math.random() * TAU,
        speed: rand(0.6, 2.1),
        bright: rand(0.35, 1),
      };
    }

    // Latitude arcs — partial, broken rings. Full circles read as a wireframe
    // globe; broken ones read as a scan.
    const arcCount = dense ? 46 : 22;
    this.arcs = new Array(arcCount);
    for (let i = 0; i < arcCount; i++) {
      const y = Math.cos((i + 0.5) / arcCount * Math.PI);
      const start = Math.random() * TAU;
      this.arcs[i] = {
        y,
        r: Math.sqrt(Math.max(0, 1 - y * y)),
        start,
        sweep: rand(0.5, 2.6),
        radius: rand(0.88, 1.0),
        w: rand(0.3, 0.9),
        phase: Math.random() * TAU,
        drift: rand(-0.25, 0.25),
      };
    }

    // Chips: the little rectangular circuit fragments scattered over the shell.
    const chipCount = dense ? 260 : 110;
    this.chips = new Array(chipCount);
    for (let i = 0; i < chipCount; i++) {
      const [x, y, z] = fibonacciPoint((i * 7 + 3) % chipCount, chipCount);
      this.chips[i] = {
        x, y, z,
        radius: rand(0.9, 1.06),
        w: rand(1.5, 6),
        h: rand(0.8, 2.4),
        phase: Math.random() * TAU,
        speed: rand(0.4, 1.6),
      };
    }

    // Orbital great-circles: the bold tilted rings crossing the sphere.
    this.orbits = [
      { tiltX: 0.42, tiltZ: -0.18, radius: 1.14, w: 1.5, speed: 0.10, alpha: 0.55 },
      { tiltX: -0.62, tiltZ: 0.35, radius: 0.99, w: 1.0, speed: -0.07, alpha: 0.38 },
      { tiltX: 1.25, tiltZ: 0.10, radius: 1.06, w: 0.8, speed: 0.13, alpha: 0.26 },
    ];
    this.orbitSteps = dense ? 200 : 96;

    // Motes drifting in the volume around the shell.
    const moteCount = dense ? 150 : 60;
    this.motes = new Array(moteCount);
    for (let i = 0; i < moteCount; i++) {
      const [x, y, z] = fibonacciPoint(i, moteCount);
      this.motes[i] = {
        x, y, z,
        radius: rand(1.05, 1.5),
        size: rand(0.4, 1.5),
        phase: Math.random() * TAU,
        speed: rand(0.2, 0.9),
      };
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.w = w;
    this.h = h;
    this.cx = w / 2;
    this.cy = h / 2;
    this.baseR = Math.min(w, h) * 0.36;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setState(name) {
    if (name === this.state) return;
    this.state = name;
    this.stateT = 0;
    this.ping();
  }

  setLevel(v) {
    this.level = clamp(v, 0, 1);
  }

  /* One-shot outward ripple — used on state changes and on wake. */
  ping() {
    this.pulse = 1;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.update(dt);
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }

  update(dt) {
    this.time += dt;
    this.stateT = Math.min(1, this.stateT + dt * 2.5);
    this.pulse = Math.max(0, this.pulse - dt * 1.4);

    // Attack fast, release slow: speech transients should snap the core bright
    // and then fall away, rather than flicker.
    const target = this.level;
    const k = target > this.smooth ? 18 : 5;
    this.smooth += (target - this.smooth) * Math.min(1, dt * k);
    this.energy += (this.smooth - this.energy) * Math.min(1, dt * 2.2);

    const spinRate = {
      idle: 0.055,
      listening: 0.10,
      thinking: 0.34,
      speaking: 0.15,
      error: 0.02,
    }[this.state] ?? 0.055;
    this.spin += dt * (spinRate + this.smooth * 0.22);

    const tintTarget = this.state === "listening" || this.state === "error" ? 1 : 0;
    this.tint += (tintTarget - this.tint) * Math.min(1, dt * 4);
  }

  /* Rotate a unit-sphere point by the current spin (Y) and a fixed tilt (X),
   * then project. Returns screen x/y, depth in -1..1, and a scale factor. */
  project(px, py, pz, radius) {
    const s = Math.sin(this.spin);
    const c = Math.cos(this.spin);
    let x = px * c + pz * s;
    let z = -px * s + pz * c;
    let y = py;

    // Fixed tilt so we never look straight down the equator.
    const tilt = 0.34;
    const st = Math.sin(tilt);
    const ct = Math.cos(tilt);
    const y2 = y * ct - z * st;
    const z2 = y * st + z * ct;

    // Mild perspective: front geometry reads larger, which sells the volume.
    const persp = 1 / (1 - z2 * 0.16);
    const r = this.baseR * radius;
    return {
      x: this.cx + x * r * persp,
      y: this.cy + y2 * r * persp,
      z: z2,
      persp,
    };
  }

  stateColor(depth) {
    // Limb is deeper/cooler, front face is hot. depth is -1 (back) .. 1 (front).
    const t = (depth + 1) / 2;
    let c = mixRgb(PALETTE.deep, PALETTE.hot, Math.pow(t, 0.8));
    if (this.tint > 0.001) {
      const alt = this.state === "error" ? PALETTE.alarm : PALETTE.cool;
      c = mixRgb(c, alt, this.tint * 0.7);
    }
    return c;
  }

  draw() {
    const ctx = this.ctx;
    const { w, h } = this;

    ctx.clearRect(0, 0, w, h);

    const bloom = 0.55 + this.energy * 0.85 + this.pulse * 0.4;

    // Ambient wash behind the shell.
    const amb = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, this.baseR * 2.4);
    amb.addColorStop(0, rgba(PALETTE.mid, 0.10 * bloom));
    amb.addColorStop(0.45, rgba(PALETTE.deep, 0.045 * bloom));
    amb.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = amb;
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    this.drawBackHalf();
    this.drawCore(bloom);
    this.drawFrontHalf();
    this.drawStreak(bloom);

    ctx.globalCompositeOperation = "source-over";
  }

  /* Geometry is drawn in two passes so the core glow sits between the far and
   * near hemispheres. That single ordering choice is what makes it read as a
   * volume instead of a flat disc. */
  drawBackHalf() { this.drawShell(-1); }
  drawFrontHalf() { this.drawShell(1); }

  drawShell(side) {
    const ctx = this.ctx;
    const t = this.time;
    const breathe = 1 + Math.sin(t * 0.6) * 0.012 + this.energy * 0.075 + this.pulse * 0.05;
    const backDim = side < 0 ? 0.34 : 1;

    // --- radial filaments -------------------------------------------------
    for (let i = 0; i < this.filaments.length; i++) {
      const f = this.filaments[i];
      const mid = this.project(f.x, f.y, f.z, 1);
      if ((mid.z > 0) !== (side > 0)) continue;

      // Each filament breathes on its own phase; the pulse pushes outward.
      const wob = 1 + Math.sin(t * f.speed + f.phase) * 0.035 + this.pulse * 0.09;
      const inner = f.inner * breathe * wob;
      const outer = f.outer * breathe * wob;

      const a = this.project(f.x, f.y, f.z, inner);
      const b = this.project(f.x, f.y, f.z, outer);

      const depth = mid.z;
      const flick = 0.72 + 0.28 * Math.sin(t * f.speed * 1.7 + f.phase);
      const alpha = clamp(
        f.bright * flick * (0.30 + 0.55 * ((depth + 1) / 2)) * backDim * (0.6 + this.energy * 0.7),
        0, 1,
      );
      if (alpha < 0.012) continue;

      ctx.strokeStyle = rgba(this.stateColor(depth), alpha);
      ctx.lineWidth = f.w * mid.persp;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // --- latitude arcs ----------------------------------------------------
    const steps = 26;
    for (let i = 0; i < this.arcs.length; i++) {
      const arc = this.arcs[i];
      const start = arc.start + t * arc.drift;
      const radius = arc.radius * breathe;
      const shimmer = 0.5 + 0.5 * Math.sin(t * 0.9 + arc.phase);

      ctx.beginPath();
      let drawn = 0;
      let prevOk = false;
      for (let s = 0; s <= steps; s++) {
        const ang = start + (arc.sweep * s) / steps;
        const px = Math.cos(ang) * arc.r;
        const pz = Math.sin(ang) * arc.r;
        const p = this.project(px, arc.y, pz, radius);
        const onSide = (p.z > 0) === (side > 0);
        if (!onSide) { prevOk = false; continue; }
        if (!prevOk) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
        prevOk = true;
        drawn++;
      }
      if (!drawn) continue;

      const alpha = clamp((0.16 + shimmer * 0.24) * backDim * (0.7 + this.energy * 0.5), 0, 1);
      ctx.strokeStyle = rgba(this.stateColor(side * 0.5), alpha);
      ctx.lineWidth = arc.w;
      ctx.stroke();
    }

    // --- chips ------------------------------------------------------------
    for (let i = 0; i < this.chips.length; i++) {
      const chip = this.chips[i];
      const p = this.project(chip.x, chip.y, chip.z, chip.radius * breathe);
      if ((p.z > 0) !== (side > 0)) continue;

      const blink = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * chip.speed + chip.phase), 2);
      const alpha = clamp(blink * (0.30 + 0.45 * ((p.z + 1) / 2)) * backDim, 0, 1);
      if (alpha < 0.02) continue;

      ctx.fillStyle = rgba(this.stateColor(p.z), alpha);
      const cw = chip.w * p.persp;
      const ch = chip.h * p.persp;
      ctx.fillRect(p.x - cw / 2, p.y - ch / 2, cw, ch);
    }

    // --- orbital great-circles -------------------------------------------
    for (let i = 0; i < this.orbits.length; i++) {
      const orb = this.orbits[i];
      const ang0 = t * orb.speed;
      ctx.beginPath();
      let prevOk = false;
      let drawn = 0;
      for (let s = 0; s <= this.orbitSteps; s++) {
        const a = (s / this.orbitSteps) * TAU;
        // Circle in XZ, then tilted into place.
        let px = Math.cos(a);
        let pz = Math.sin(a);
        let py = 0;
        const cx1 = Math.cos(orb.tiltX), sx1 = Math.sin(orb.tiltX);
        let y1 = py * cx1 - pz * sx1;
        let z1 = py * sx1 + pz * cx1;
        const cz1 = Math.cos(orb.tiltZ + ang0), sz1 = Math.sin(orb.tiltZ + ang0);
        const x2 = px * cz1 - y1 * sz1;
        const y2 = px * sz1 + y1 * cz1;

        const p = this.project(x2, y2, z1, orb.radius * breathe);
        const onSide = (p.z > 0) === (side > 0);
        if (!onSide) { prevOk = false; continue; }
        if (!prevOk) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
        prevOk = true;
        drawn++;
      }
      if (!drawn) continue;
      ctx.strokeStyle = rgba(this.stateColor(side * 0.7), orb.alpha * backDim * (0.6 + this.energy * 0.6));
      ctx.lineWidth = orb.w;
      ctx.stroke();
    }

    // --- motes ------------------------------------------------------------
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i];
      const drift = 1 + Math.sin(t * m.speed + m.phase) * 0.05;
      const p = this.project(m.x, m.y, m.z, m.radius * drift * breathe);
      if ((p.z > 0) !== (side > 0)) continue;
      const alpha = clamp((0.10 + 0.30 * Math.abs(Math.sin(t * m.speed * 0.7 + m.phase))) * backDim, 0, 1);
      ctx.fillStyle = rgba(PALETTE.hot, alpha);
      const s = m.size * p.persp;
      ctx.fillRect(p.x, p.y, s, s);
    }
  }

  drawCore(bloom) {
    const ctx = this.ctx;
    const r = this.baseR * (0.30 + this.energy * 0.13 + this.pulse * 0.07);

    const g = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, r);
    const hot = this.tint > 0.01
      ? mixRgb(PALETTE.core, this.state === "error" ? PALETTE.alarm : PALETTE.cool, this.tint * 0.5)
      : PALETTE.core;
    g.addColorStop(0, rgba(hot, 0.95 * bloom));
    g.addColorStop(0.18, rgba(PALETTE.hot, 0.55 * bloom));
    g.addColorStop(0.48, rgba(PALETTE.mid, 0.20 * bloom));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, r, 0, TAU);
    ctx.fill();
  }

  /* Anamorphic lens streak through the core — the horizontal flare that reads
   * instantly as "projected light" rather than "drawn circle". */
  drawStreak(bloom) {
    const ctx = this.ctx;
    const len = this.baseR * (1.5 + this.energy * 0.7);
    const thick = 1.5 + this.energy * 3.5;

    const g = ctx.createLinearGradient(this.cx - len, this.cy, this.cx + len, this.cy);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.34, rgba(PALETTE.mid, 0.10 * bloom));
    g.addColorStop(0.5, rgba(PALETTE.core, 0.42 * bloom));
    g.addColorStop(0.66, rgba(PALETTE.mid, 0.10 * bloom));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(this.cx - len, this.cy - thick / 2, len * 2, thick);
  }
}
