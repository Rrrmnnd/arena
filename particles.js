// Particle bursts (punch impacts, collisions, wall slams), a fading crack decal for wall
// rams, and a quick flash ring for extra punch on the biggest hits.

const particles = [];

// Hard ceiling on live particles. A few effects firing at once (an ultimate landing into a
// wall slam, say) could otherwise pile up thousands, and particle drawing is the single most
// expensive thing in the renderer — past this point the oldest are dropped, which is invisible
// (they were already the most faded) and keeps the frame budget bounded no matter what.
const MAX_PARTICLES = 500;

// Halo sprites, rendered once per colour and reused forever. Building a radial gradient per
// particle per frame was costing ~65ms/frame under load — four times the entire 60fps budget —
// because every gradient is a fresh allocation the GPU can't cache. There are only a handful
// of distinct particle colours in the whole game, so this map stays tiny.
const HALO_SPRITE_R = 32;
const haloSprites = new Map();

function getHaloSprite(color) {
  let s = haloSprites.get(color);
  if (s) return s;
  s = document.createElement("canvas");
  s.width = s.height = HALO_SPRITE_R * 2;
  const g = s.getContext("2d");
  const grad = g.createRadialGradient(
    HALO_SPRITE_R, HALO_SPRITE_R, 0,
    HALO_SPRITE_R, HALO_SPRITE_R, HALO_SPRITE_R
  );
  grad.addColorStop(0, color);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, HALO_SPRITE_R * 2, HALO_SPRITE_R * 2);
  haloSprites.set(color, s);
  return s;
}

class Particle {
  constructor(x, y, color, scale = 1, gravity = 0) {
    this.x = x;
    this.y = y;
    this.prevX = x; // last frame's position — a spark's trail is drawn between the two
    this.prevY = y;
    const angle = Math.random() * Math.PI * 2;
    const speed = (80 + Math.random() * 160) * scale;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.gravity = gravity;
    this.life = (0.18 + Math.random() * 0.22) * Math.max(1, scale);
    this.maxLife = this.life;
    this.size = (2 + Math.random() * 3) * scale;
    this.color = color;
    this.shape = Math.random() < 0.3 ? "square" : "circle"; // a little visual variety
    this.spin = (Math.random() * 2 - 1) * 6;
    this.angle = Math.random() * Math.PI * 2;
    // Sparks/energy render additively with a soft halo and a motion trail, so a burst reads as
    // hot flying debris rather than flat confetti. Blood (see spawnBloodSpurt) turns this off —
    // additive blending would wash dark red out to orange and stop it reading as blood.
    this.glow = false;
  }

  update(dt) {
    this.prevX = this.x;
    this.prevY = this.y;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= 0.92;
    this.vy = this.vy * 0.92 + this.gravity * dt;
    this.angle += this.spin * dt;
    this.life -= dt;
  }

  // Assumes the caller has already set the blend mode for this particle's group — see
  // drawParticles, which batches all the additive ones together rather than flipping the
  // composite mode (and save/restoring) once per particle.
  draw(ctx) {
    if (this.life <= 0) return;
    const t = Math.max(0, this.life / this.maxLife);
    // Eased so a spark holds its brightness most of its life then drops off fast, instead of
    // dimming linearly the whole way (which reads as mushy).
    const alpha = t * t * (3 - 2 * t);

    // Each extra draw op per particle costs far more than its own fill: interleaving them
    // thrashes globalAlpha, which breaks the canvas's batching (measured: trail 13ms +
    // core/halo 30ms individually, but 62ms combined, at 4500 particles). So both extras are
    // gated to the particles that actually benefit, rather than run on every one.
    if (this.glow) {
      // Motion trail, only for genuinely fast debris — on a slow particle the streak is
      // shorter than the core and invisible anyway.
      const dx = this.x - this.prevX, dy = this.y - this.prevY;
      if (dx * dx + dy * dy > 36) {
        ctx.globalAlpha = alpha * 0.5;
        ctx.strokeStyle = this.color;
        ctx.lineWidth = this.size * 0.9;
        ctx.beginPath();
        ctx.moveTo(this.prevX, this.prevY);
        ctx.lineTo(this.x, this.y);
        ctx.stroke();
      }
      // Soft halo, only on the larger particles — it's the single biggest fill-rate cost, and
      // on a 2px spark it adds nothing the additive core doesn't already give.
      if (this.size >= 3) {
        // Kept deliberately weak: these stack additively, and on a dense burst a stronger halo
        // saturates the whole cluster to flat white blobs instead of reading as separate sparks.
        const hr = this.size * 2.2;
        ctx.globalAlpha = alpha * 0.18;
        ctx.drawImage(getHaloSprite(this.color), this.x - hr, this.y - hr, hr * 2, hr * 2);
      }
    }

    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;

    if (this.shape === "circle") {
      // The common case by far — kept transform-free so it costs a bare arc+fill
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.angle);
      if (this.shape === "square") {
        ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
      } else {
        // An elongated droplet stretched along its own travel direction, for a "spurt" read
        // instead of a round puff — used by spawnBloodSpurt.
        ctx.beginPath();
        ctx.ellipse(0, 0, (this.streakLen || this.size * 3) / 2, this.size * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

// A blood-spurt variant of spawnImpactParticles: droplets fired in a cone around `angle` (the
// hit direction) that arc downward under gravity instead of just puffing outward and fading in
// place, plus a handful of longer streaks shot straight down that direction for an actual
// "spurt" read rather than a mist.
function spawnBloodSpurt(x, y, angle, count = 16, scale = 1) {
  const reds = ["#8a0f0f", "#b81f1f", "#d43535"];
  for (let i = 0; i < count; i++) {
    const a = angle + (Math.random() - 0.5) * 1.6; // roughly a 90 degree cone around the hit direction
    const speed = (140 + Math.random() * 220) * scale;
    const p = new Particle(x, y, reds[Math.floor(Math.random() * reds.length)], scale, 420);
    p.vx = Math.cos(a) * speed;
    p.vy = Math.sin(a) * speed;
    p.life = p.maxLife = (0.35 + Math.random() * 0.35) * Math.max(1, scale);
    p.shape = "circle";
    particles.push(p);
  }
  const streakCount = Math.max(2, Math.round(count / 5));
  for (let i = 0; i < streakCount; i++) {
    const a = angle + (Math.random() - 0.5) * 0.5;
    const speed = (260 + Math.random() * 160) * scale;
    const p = new Particle(x, y, reds[1], scale, 420);
    p.vx = Math.cos(a) * speed;
    p.vy = Math.sin(a) * speed;
    p.life = p.maxLife = (0.3 + Math.random() * 0.2) * Math.max(1, scale);
    p.shape = "streak";
    p.streakLen = (10 + Math.random() * 10) * scale;
    p.angle = a;
    p.spin = 0;
    particles.push(p);
  }
}

// `color` can be a single CSS color or an array to pick from randomly, for more variety.
// Every spark glows additively and trails (see Particle.draw), and a fraction of them are
// promoted to long fast "shards" that outrun the main puff — that spread of speeds is what
// stops a burst reading as one uniform blob.
function spawnImpactParticles(x, y, color = "#ffcf6b", count = 10, scale = 1, gravity = 0) {
  const palette = Array.isArray(color) ? color : [color];
  for (let i = 0; i < count; i++) {
    const c = palette[Math.floor(Math.random() * palette.length)];
    const p = new Particle(x, y, c, scale, gravity);
    p.glow = true;
    particles.push(p);
  }
  // A handful of outrunners, proportional to the burst. Deliberately NO minimum: a floor here
  // meant a 1-particle spawn still got 2 shards — tripling the cost of every small, frequently
  // repeated effect (bullet pings, contact sparks) across the whole cast.
  const shardCount = Math.floor(count * 0.3);
  for (let i = 0; i < shardCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = (320 + Math.random() * 380) * scale;
    const p = new Particle(x, y, palette[Math.floor(Math.random() * palette.length)], scale, gravity);
    p.vx = Math.cos(a) * speed;
    p.vy = Math.sin(a) * speed;
    p.size = (1.2 + Math.random() * 1.6) * scale;
    p.life = p.maxLife = (0.22 + Math.random() * 0.2) * Math.max(1, scale);
    p.shape = "circle";
    p.glow = true;
    particles.push(p);
  }
}

// A one-shot puff of smoke — a handful of soft overlapping grey blobs that bloom outward and
// fade over `duration` seconds — for a "poof" transformation moment (e.g. the Ninja's Shadow
// Clone appearing), as opposed to spawnImpactParticles' scattering sparks. Not a persistent,
// stateful cloud like the old smoke bomb ultimate used to be — just a quick burst.
const smokePuffs = [];
// More blobs and higher opacity than the first pass — read as too thin/sparse to sell an actual
// smoke-bomb burst.
const SMOKE_PUFF_OFFSETS = [
  [0, 0, 1.05], [0.4, 0.2, 0.78], [-0.35, 0.25, 0.74], [0.15, -0.4, 0.78], [-0.3, -0.2, 0.68],
  [0.2, 0.36, 0.6], [-0.22, -0.34, 0.6], [0.34, -0.08, 0.58],
];

function spawnSmokePuff(x, y, maxRadius = 56, duration = 0.5) {
  smokePuffs.push({ x, y, maxRadius, life: duration, maxLife: duration });
}

function updateSmokePuffs(dt) {
  for (let i = smokePuffs.length - 1; i >= 0; i--) {
    smokePuffs[i].life -= dt;
    if (smokePuffs[i].life <= 0) smokePuffs.splice(i, 1);
  }
}

function drawSmokePuffs(ctx) {
  for (const p of smokePuffs) {
    const t = 1 - p.life / p.maxLife; // 0 -> 1 across its lifetime
    const radius = p.maxRadius * (0.35 + 0.65 * t); // blooms outward as it fades
    const alpha = Math.max(0, 1 - t) * 0.88;
    for (const [ox, oy, s] of SMOKE_PUFF_OFFSETS) {
      const px = p.x + ox * radius, py = p.y + oy * radius, pr = radius * s;
      const grad = ctx.createRadialGradient(px, py, 0, px, py, pr);
      grad.addColorStop(0, `rgba(150,150,158,${alpha})`);
      grad.addColorStop(0.6, `rgba(120,120,128,${alpha * 0.72})`);
      grad.addColorStop(1, "rgba(110,110,118,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update(dt);
    if (particles[i].life <= 0) particles.splice(i, 1);
  }
  // Enforced here rather than at every spawn site so it holds whatever route particles
  // arrived by. The oldest go first — they're the most faded, so the trim is invisible.
  if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
}

// Two batched passes instead of one interleaved loop: every particle used to save/restore and
// flip globalCompositeOperation individually, which is a full canvas state change per particle.
// Grouping them means exactly one state change per frame for the whole burst.
function drawParticles(ctx) {
  let hasGlow = false;

  // Pass 1 — ordinary particles (blood, debris) under normal blending
  ctx.save();
  for (const p of particles) {
    if (p.glow) { hasGlow = true; continue; }
    p.draw(ctx);
  }
  ctx.restore();

  if (!hasGlow) return;

  // Pass 2 — sparks and energy, all additive together
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (const p of particles) if (p.glow) p.draw(ctx);
  ctx.restore();
}

// Quick expanding ring of light for extra "oomph" on big impacts.
const flashes = [];

function spawnFlash(x, y, color = "#ffffff", maxRadius = 50, duration = 0.25) {
  flashes.push({ x, y, color, maxRadius, life: duration, maxLife: duration });
}

function updateFlashes(dt) {
  for (let i = flashes.length - 1; i >= 0; i--) {
    flashes[i].life -= dt;
    if (flashes[i].life <= 0) flashes.splice(i, 1);
  }
}

// Three layers stacked, all additive so they bloom against the dark arena: a soft wide glow
// wash, a bright thin leading edge racing ahead of it, and — for the first instant only — a
// softly lit core at the point of impact. Eased so the ring bursts outward fast and then
// decelerates, which reads as a shockwave rather than a circle growing at a constant rate.
// The core is tinted with the effect's own colour rather than blown out to white: a white core
// under additive blending is what made heavy hits glare.
function drawFlashes(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const f of flashes) {
    const t = 1 - Math.max(0, f.life / f.maxLife); // 0 -> 1 as it expands
    const eased = 1 - Math.pow(1 - t, 2.4); // fast out, then settles
    const r = f.maxRadius * eased;
    const fade = 1 - t;

    // Wide soft wash trailing the edge
    ctx.globalAlpha = fade * 0.32;
    const wash = ctx.createRadialGradient(f.x, f.y, r * 0.35, f.x, f.y, r * 1.12);
    wash.addColorStop(0, "rgba(0,0,0,0)");
    wash.addColorStop(0.72, f.color);
    wash.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = wash;
    ctx.beginPath();
    ctx.arc(f.x, f.y, r * 1.12, 0, Math.PI * 2);
    ctx.fill();

    // Bright leading edge
    ctx.globalAlpha = fade * 0.95;
    ctx.strokeStyle = f.color;
    ctx.lineWidth = 3.5 * fade + 1;
    ctx.beginPath();
    ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
    ctx.stroke();

    // Core, only for the opening instant
    if (t < 0.35) {
      const coreFade = 1 - t / 0.35;
      ctx.globalAlpha = coreFade * 0.3;
      const core = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.maxRadius * 0.42);
      core.addColorStop(0, f.color);
      core.addColorStop(0.45, f.color);
      core.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.maxRadius * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- speed lines
// The classic anime impact frame: tapered lines stabbing inward from the edges toward the
// centre, held for a fraction of a second. Fired automatically from triggerShake (main.js) on
// finisher-weight blows only, so it stays an event rather than wallpaper. Screen space, so it
// frames the whole shot regardless of where the hit landed.
let speedLines = null;

// Deliberately a muted blue-grey rather than white: these sit on top of the whole frame, and
// pure white under additive blending was a big part of what made finishers glare.
function spawnSpeedLines(duration = 0.22, color = "rgba(150,158,205,") {
  const lines = [];
  const count = 34;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.14;
    lines.push({
      a,
      // Where its inner end stops, as a fraction of the reach — the spread is what keeps the
      // ring of lines ragged instead of a clean uniform starburst.
      inner: 0.46 + Math.random() * 0.3,
      w: 2 + Math.random() * 5,
    });
  }
  speedLines = { lines, color, life: duration, maxLife: duration };
}

function updateSpeedLines(dt) {
  if (!speedLines) return;
  speedLines.life -= dt;
  if (speedLines.life <= 0) speedLines = null;
}

function drawSpeedLines(ctx) {
  if (!speedLines) return;
  const t = Math.max(0, speedLines.life / speedLines.maxLife);
  const cx = WIDTH / 2, cy = HEIGHT / 2;
  // Lines drive inward over the life, then fade out
  const drive = 1 - Math.pow(t, 1.5);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (const l of speedLines.lines) {
    const ca = Math.cos(l.a), sa = Math.sin(l.a);
    // How far the frame edge is along THIS ray specifically. A single shared radius (the
    // half-diagonal) doesn't work: it's only correct toward the corners, and leaves every
    // near-horizontal line starting far off-canvas and never becoming visible at all.
    const edge = Math.min(
      Math.abs(ca) < 1e-6 ? Infinity : (WIDTH / 2) / Math.abs(ca),
      Math.abs(sa) < 1e-6 ? Infinity : (HEIGHT / 2) / Math.abs(sa)
    );
    const outerR = edge * 1.04;                        // just past the edge, so no floating stub
    const innerR = edge * (l.inner - drive * 0.14);    // stabs deeper inward as it drives
    ctx.globalAlpha = t * 0.26;
    ctx.strokeStyle = speedLines.color + `${(t * 0.26).toFixed(3)})`;
    ctx.lineWidth = l.w * (0.5 + t * 0.5);
    ctx.beginPath();
    ctx.moveTo(cx + ca * outerR, cy + sa * outerR);
    ctx.lineTo(cx + ca * innerR, cy + sa * innerR);
    ctx.stroke();
  }
  ctx.restore();
}

// Floating damage numbers: pop up from the hit point and drift upward while fading out.
const damageNumbers = [];

function spawnDamageNumber(x, y, amount, big = false, isHeal = false, colorOverride = null) {
  const jitterX = (Math.random() * 2 - 1) * 14;
  damageNumbers.push({
    x: x + jitterX,
    y,
    text: `${isHeal ? "+" : "-"}${Math.ceil(amount)}`,
    color: colorOverride || (isHeal ? "#4ef07a" : (big ? "#ff5050" : "#ffffff")),
    big,
    vy: -60,
    vx: jitterX * 0.6, // drifts out along the side it popped to, instead of straight up
    life: 0.8,
    maxLife: 0.8,
    // A slight tilt, alternating side to side, so a rapid flurry of numbers doesn't stack up
    // into one unreadable vertical column
    rot: (Math.random() * 2 - 1) * 0.22,
  });
}

function updateDamageNumbers(dt) {
  for (let i = damageNumbers.length - 1; i >= 0; i--) {
    const d = damageNumbers[i];
    d.y += d.vy * dt;
    d.x += d.vx * dt;
    d.vy *= 0.94;
    d.vx *= 0.9;
    d.life -= dt;
    if (d.life <= 0) damageNumbers.splice(i, 1);
  }
}

function drawDamageNumbers(ctx) {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const d of damageNumbers) {
    const t = Math.max(0, d.life / d.maxLife); // 1 -> 0
    const age = 1 - t;
    // Overshoot pop: punches out past full size in the first ~12% of its life, settles back,
    // then shrinks slightly as it fades. Static text just appearing has no impact by comparison.
    let scale;
    if (age < 0.12) scale = 0.4 + 0.85 * (age / 0.12);
    else if (age < 0.26) scale = 1.25 - 0.25 * ((age - 0.12) / 0.14);
    else scale = 1 - 0.12 * ((age - 0.26) / 0.74);
    const alpha = Math.min(1, t * 1.8); // holds solid, only fades over the last stretch

    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.rot);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.font = d.big ? "bold 30px Arial" : "bold 18px Arial";

    // Big hits get an additive glow behind them so they read as loud, not just large
    if (d.big) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = alpha * 0.5;
      ctx.fillStyle = d.color;
      ctx.filter = "blur(6px)";
      ctx.fillText(d.text, 0, 0);
      ctx.restore();
    }

    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = d.big ? 5 : 3.5;
    ctx.lineJoin = "round";
    ctx.strokeText(d.text, 0, 0);
    ctx.fillStyle = d.color;
    ctx.fillText(d.text, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.textBaseline = "alphabetic";
}

// Wall cracks: a handful of jagged lines that flash in at the impact point and fade out.
const wallCracks = [];

function spawnWallCrack(x, y) {
  const lines = [];
  const lineCount = 6 + Math.floor(Math.random() * 4);
  for (let i = 0; i < lineCount; i++) {
    const angle = (i / lineCount) * Math.PI * 2 + Math.random() * 0.5;
    const length = 30 + Math.random() * 40;
    lines.push({ angle, length });
  }
  wallCracks.push({ x, y, lines, life: 1.4, maxLife: 1.4 });
}

function updateWallCracks(dt) {
  for (let i = wallCracks.length - 1; i >= 0; i--) {
    wallCracks[i].life -= dt;
    if (wallCracks[i].life <= 0) wallCracks.splice(i, 1);
  }
}

function drawWallCracks(ctx) {
  for (const crack of wallCracks) {
    const alpha = Math.max(0, Math.min(1, crack.life / crack.maxLife)) * 0.85;
    ctx.save();
    ctx.translate(crack.x, crack.y);
    ctx.strokeStyle = `rgba(15,15,20,${alpha})`;
    ctx.lineWidth = 3;
    for (const line of crack.lines) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(line.angle) * line.length, Math.sin(line.angle) * line.length);
      ctx.stroke();
    }
    ctx.restore();
  }
}
