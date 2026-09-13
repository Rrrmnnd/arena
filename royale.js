// Battle Royale — the entire cast in one arena at once, last one standing.
//
// ---------------------------------------------------------------------------------------
// The one thing to know before reading further: TARGETING IS SINGLE-TARGET, AND THAT IS A
// CONSTRAINT OF THE ENGINE, NOT A CHOICE MADE HERE.
//
// Every character takes exactly one `opponent` in update(dt, opponent), and almost all of them
// act on it directly — `opponent.takeDamage(...)`, distances measured against `opponent.x/y`.
// Only five of the fifteen files build a list at all (via opponent.getExtraBodies(), which
// exists for the Ninja's clones). There is no seam to widen: making a fireball damage whoever it
// physically overlaps would mean rewriting the hit detection in all fifteen character files.
//
// So in here each fighter is locked onto one enemy and their attacks affect that enemy only. A
// shot that visually passes through a bystander does not hurt them. VS BOSS has always worked
// this way too — its three allies cannot hit each other, only the boss.
//
// What this mode does do about it is make the lock STICKY (see ROYALE_RETARGET). Re-picking the
// nearest enemy every frame was the version that actually looked broken: a shot already in the
// air is re-tested against whatever its owner is nearest to right now, so in a crowd the damage
// number would land on somebody the shot was visibly nowhere near. Holding a target for a couple
// of seconds keeps each fighter in a coherent duel, and the crowd reads as a dozen duels
// happening at once — which is what a brawl looks like anyway.
// ---------------------------------------------------------------------------------------

// How long a fighter stays locked on before it is allowed to look for someone closer. Long
// enough that a projectile's whole flight belongs to one target; short enough that nobody keeps
// chasing someone across the arena while being hit from behind.
const ROYALE_RETARGET = 2.4;
// A target more than this much closer than the current one steals the lock early — otherwise a
// fighter walks past somebody attacking it to reach the one it happened to pick first.
const ROYALE_STEAL_MARGIN = 0.55;

const ROYALE_PIP = 40;
const ROYALE_PIP_GAP = 6;

let royaleFighters = [];        // every body still in the running order, alive or not
let royaleOrder = [];           // ROSTER indices, parallel to royaleFighters
let royaleState = "playing";    // "playing" | "ended" | "prompting"
let royaleWinner = null;        // the surviving fighter, or null for a wipe
let royaleEndTimer = 0;
let royalePendingBlob = null;
let royalePromptReady = false;
let royaleQueuedDecision = null;

function royaleAlive() {
  return royaleFighters.filter((f) => f.alive);
}

// Spread evenly around a ring inside the arena, so nobody opens the fight already on top of
// somebody else and no one corner is crowded. The ring is inset by the biggest body on the
// field so even the Giant starts fully inside the walls.
function royalePlace() {
  const cx = ARENA.x + ARENA.w / 2;
  const cy = ARENA.y + ARENA.h / 2;
  const biggest = Math.max(...royaleFighters.map((f) => f.size)) / 2;
  const rx = Math.max(40, ARENA.w / 2 - biggest - CORNER_MARGIN);
  const ry = Math.max(40, ARENA.h / 2 - biggest - CORNER_MARGIN);
  const n = royaleFighters.length;
  const spin = Math.random() * Math.PI * 2;
  royaleFighters.forEach((f, i) => {
    const a = spin + (i / n) * Math.PI * 2;
    f.x = cx + Math.cos(a) * rx;
    f.y = cy + Math.sin(a) * ry;
  });
}

// `forStream` is a Twitch-triggered round: no clip recording, same reason as the gauntlet's.
function startRoyaleRound(forStream = false) {
  if (isRecording) stopRecording();
  // Pillars are registered globally so projectiles can be blocked without knowing who raised
  // them; a previous round's Earth Mage would go on blocking things here. See combat.js.
  clearWorldObstacles();
  clearFieldEffects();

  royaleOrder = ROSTER.map((_, i) => i);
  royaleFighters = royaleOrder.map((idx) => {
    const f = ROSTER[idx].ctor();
    Object.assign(f, randomVelocity(f.speed));
    f.royaleTarget = null;
    f.royaleLock = 0;
    return f;
  });
  royalePlace();

  royaleState = "playing";
  royaleWinner = null;
  royaleEndTimer = 0;
  royalePendingBlob = null;
  royalePromptReady = false;
  royaleQueuedDecision = null;

  matchTitle = `Battle Royale — ${royaleFighters.length} fighters`;
  document.title = matchTitle;
  if (!forStream) startRecording();
}

// Everything a fighter is allowed to shoot at: every other fighter still standing, plus their
// extra bodies (the Ninja's clones), minus anything currently untrackable.
function royaleTargetsFor(f) {
  const out = [];
  for (const other of royaleFighters) {
    if (other === f || other.isInvisibleToOpponents) continue;
    for (const body of [other, ...other.getExtraBodies()]) {
      if (body.alive && body !== f) out.push(body);
    }
  }
  return out;
}

// The sticky lock. Held for ROYALE_RETARGET unless it dies, goes untrackable, or somebody gets
// materially closer — see the note at the top of the file for why this is not just "nearest".
function royalePickTarget(f, dt) {
  f.royaleLock -= dt;
  const options = royaleTargetsFor(f);
  if (!options.length) { f.royaleTarget = null; return null; }

  const cur = f.royaleTarget;
  const curOk = cur && cur.alive && options.includes(cur);
  if (curOk && f.royaleLock > 0) {
    const curD = Math.hypot(cur.x - f.x, cur.y - f.y);
    const near = nearestTo(f, options);
    const nearD = Math.hypot(near.x - f.x, near.y - f.y);
    if (nearD > curD * ROYALE_STEAL_MARGIN) return cur;
  }
  f.royaleTarget = nearestTo(f, options);
  f.royaleLock = ROYALE_RETARGET;
  return f.royaleTarget;
}

// The whole simulation step, standing in for the two-fighter block in main.js.
function royaleUpdate(dt) {
  for (const f of royaleFighters) {
    if (!f.alive) { f.update(dt, null); continue; }
    f.update(dt, royalePickTarget(f, dt));
  }

  // Every pair, bodies and extras alike, so nobody stands inside anybody.
  const bodies = [];
  for (const f of royaleFighters) {
    bodies.push(f, ...f.getExtraBodies());
  }
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) resolveCollision(bodies[i], bodies[j]);
  }

  // Solids owned by a character (Poop Man's boulder) separate everyone AFTER every body has
  // moved — doing it inside the owner's own update is too early. Same hook the duel block uses.
  for (const f of royaleFighters) {
    if (typeof f.resolveSolids === "function") f.resolveSolids(dt, bodies);
  }
}

function royaleTick() {
  if (royaleState !== "playing") return;
  if (royaleFighters.some(hasSelfDestructPending)) return;
  if (royaleFighters.some(hasBombsPending)) return;
  if (royaleFighters.some((f) => f.blocksRoundEnd)) return;

  const standing = royaleFighters.filter((f) => !isFighterDown(f));
  if (standing.length > 1) return;

  royaleWinner = standing.length === 1 && standing[0].alive ? standing[0] : null;
  royaleState = "ended";
  royaleEndTimer = 0;
  if (royaleWinner && typeof royaleWinner.onVictory === "function") royaleWinner.onVictory();
  else if (!royaleWinner) playSfx("draw", 0.8);
}

function keepRoyaleRecording() {
  if (royalePendingBlob) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const ext = royalePendingBlob.type.includes("mp4") ? "mp4" : "webm";
    const who = royaleWinner ? royaleWinner.name : "draw";
    downloadBlob(royalePendingBlob, `royale-${who}-${ts}.${ext}`.replace(/\s+/g, "-").toLowerCase());
  }
  startRoyaleRound();
}

function discardRoyaleRecording() {
  startRoyaleRound();
}

// ---------------------------------------------------------------------------------------
// drawing
// ---------------------------------------------------------------------------------------

// Fifteen full HUD panels do not fit in any frame, so the standings ARE the HUD: a portrait per
// fighter with its own health under it, greyed and struck through once it is out.
function drawRoyaleHud(ctx) {
  const n = royaleFighters.length;
  if (!n) return;
  const pitch = ROYALE_PIP + ROYALE_PIP_GAP;
  const scale = Math.min(1, (WIDTH - 80) / (n * pitch));
  const pip = ROYALE_PIP * scale;
  const step = pitch * scale;
  let x = WIDTH / 2 - (n * step - ROYALE_PIP_GAP * scale) / 2;
  const y = Math.max(12, ARENA.y - pip - 34);

  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffdc32";
  ctx.font = `bold ${Math.round(22 * Math.min(1, scale + 0.3))}px Arial`;
  ctx.fillText(`${royaleAlive().length} ALIVE`, WIDTH / 2, y - 10);

  royaleFighters.forEach((f, i) => {
    const idx = royaleOrder[i];
    const out = !f.alive;
    ctx.globalAlpha = out ? 0.3 : 1;
    const face = typeof team5Face === "function" ? team5Face(idx) : null;
    if (face) ctx.drawImage(face, x, y, pip, pip);
    ctx.globalAlpha = 1;

    if (out) {
      ctx.strokeStyle = "rgba(255,90,70,0.9)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x + pip * 0.12, y + pip * 0.12);
      ctx.lineTo(x + pip * 0.88, y + pip * 0.88);
      ctx.stroke();
    } else {
      // A health sliver under each survivor — enough to read who is in trouble at a glance.
      const bw = pip, bh = Math.max(3, pip * 0.1);
      const frac = Math.max(0, Math.min(1, f.hp / f.maxHp));
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(x, y + pip + 2, bw, bh);
      ctx.fillStyle = frac > 0.5 ? "#64f064" : frac > 0.22 ? "#ffdc32" : "#ff5a46";
      ctx.fillRect(x, y + pip + 2, bw * frac, bh);
    }
    x += step;
  });
  ctx.restore();
}

function drawRoyalePromptOverlay(ctx) {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffdc32";
  ctx.font = "bold 34px Arial";
  ctx.fillText(royaleWinner ? `${royaleWinner.name} Wins the Royale!` : "Everybody died.",
               WIDTH / 2, HEIGHT / 2 - 50);
  ctx.fillStyle = "#ffffff";
  ctx.font = "22px Arial";
  ctx.fillText(royalePromptReady ? "Keep this recording?" : "Finalizing recording…",
               WIDTH / 2, HEIGHT / 2 + 6);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "18px Arial";
  ctx.fillText("Y = keep    N = discard", WIDTH / 2, HEIGHT / 2 + 40);
  ctx.textAlign = "left";
}
