// Lab: a 16:9 test mode for characters whose power grows without bound (the Knight's speed
// ramp being the motivating case). Instead of a fight, you get one character running on its
// own plus training dummies you place by clicking — each with its own HP, a delay before it
// appears, and how long it sticks around. The panel down the right reports what the character
// is actually doing (speed, current hit damage, skill state) and what it's dealing out.
//
// Dummies never move and never fight back: they're measuring instruments, not opponents.

const LAB_DUMMY_SIZE = 60;

// Each control cycles through a fixed list rather than free-typing, so it's all mouse-driven
// like the rest of the setup UI.
const LAB_HP_OPTIONS    = [1, 25, 50, 100, 200, 500, 1000, 5000, 99999];
const LAB_DELAY_OPTIONS = [0, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90];
const LAB_LIFE_OPTIONS  = [0, 3, 5, 10, 20, 30, 60]; // 0 = stays until killed

class Dummy extends Character {
  constructor(x, y, hp) {
    super({ x, y, size: LAB_DUMMY_SIZE, color: "#8f95a3", maxHp: hp, name: "Dummy", speed: 0 });

    // A fixed obstacle: resolveCollision treats movable===false as immovable, so attackers
    // bounce off it and it never gets shoved out of the spot it was placed in.
    this.vx = 0;
    this.vy = 0;
    this.movable = false;
    this.knockbackImmune = true;
    this.attackGraceTimer = 0;

    this.damageTaken = 0;
    this.hitCount = 0;
    this.lastHit = 0;
    this.biggestHit = 0;
    this.lifeTimer = 0;   // seconds since it appeared
    this.lifespan = 0;    // 0 = no expiry
  }

  takeDamage(dmg, colorOverride = null) {
    if (dmg > 0 && this.alive) {
      this.damageTaken += dmg;
      this.hitCount++;
      this.lastHit = dmg;
      if (dmg > this.biggestHit) this.biggestHit = dmg;
    }
    super.takeDamage(dmg, colorOverride);
  }

  // Deliberately not super.update(): no movement, no wall bounce, no knockback decay.
  update(dt) {
    if (this.deathFadeTimer > 0) this.deathFadeTimer -= dt;
    if (!this.alive) return;
    if (this.hitFlashTimer > 0) this.hitFlashTimer -= dt;
    if (this.hitCooldown > 0) this.hitCooldown -= dt;
    this.vx = 0; this.vy = 0;
    this.knockbackVx = 0; this.knockbackVy = 0;
    this.lifeTimer += dt;
  }

  get expired() {
    return this.lifespan > 0 && this.lifeTimer >= this.lifespan;
  }

  // A bullseye, so it reads as a target rather than another fighter
  drawBody(ctx) {
    const r = this.size / 2;
    ctx.save();
    ctx.translate(this.x, this.y);

    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#c8ccd6";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#b0483c";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.44, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#e8ecf2";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.16, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ---------------------------------------------------------------- lab state

let labFighter = null;
let labFighterPick = null;   // ROSTER index, so Restart can rebuild a fresh instance
let labDummies = [];         // spawned and live on the field
let labPending = [];         // { x, y, hp, life, countdown } waiting out their delay
let labClock = 0;

let labHpIndex = 3;    // 100
let labDelayIndex = 0; // 0s
let labLifeIndex = 0;  // stays until killed

// Running totals across every dummy this run, including ones already killed or expired
let labTotalDamage = 0;
let labTotalHits = 0;
let labBiggestHit = 0;

function startLab(rosterIndex) {
  labFighterPick = rosterIndex;
  labFighter = ROSTER[rosterIndex].ctor();
  labFighter.x = ARENA.x + ARENA.w / 2;
  labFighter.y = ARENA.y + ARENA.h / 2;
  const ang = Math.random() * Math.PI * 2;
  labFighter.vx = Math.cos(ang) * labFighter.speed;
  labFighter.vy = Math.sin(ang) * labFighter.speed;

  labDummies = [];
  labPending = [];
  labClock = 0;
  labTotalDamage = 0;
  labTotalHits = 0;
  labBiggestHit = 0;
}

function restartLab() {
  if (labFighterPick !== null) startLab(labFighterPick);
}

function labPlaceDummy(x, y) {
  labPending.push({
    x, y,
    hp: LAB_HP_OPTIONS[labHpIndex],
    life: LAB_LIFE_OPTIONS[labLifeIndex],
    countdown: LAB_DELAY_OPTIONS[labDelayIndex],
  });
}

function labClearDummies() {
  labDummies = [];
  labPending = [];
}

function labUpdate(dt) {
  if (!labFighter) return;
  labClock += dt;

  for (let i = labPending.length - 1; i >= 0; i--) {
    const p = labPending[i];
    p.countdown -= dt;
    if (p.countdown <= 0) {
      const d = new Dummy(p.x, p.y, p.hp);
      d.lifespan = p.life;
      labDummies.push(d);
      labPending.splice(i, 1);
    }
  }

  const targets = labDummies.filter((d) => d.alive);
  const target = targets.length ? nearestTo(labFighter, targets) : null;

  // Snapshot before the fighter acts: everything it deals — melee, bullets, blasts — lands
  // inside its own update(), so diffing after that is the only way to catch it all.
  const before = labDummies.map((d) => ({ dmg: d.damageTaken, hits: d.hitCount }));
  labFighter.update(dt, target);

  for (let i = 0; i < labDummies.length; i++) {
    const d = labDummies[i];
    const gained = d.damageTaken - before[i].dmg;
    if (gained > 0) {
      labTotalDamage += gained;
      labTotalHits += d.hitCount - before[i].hits;
      if (d.biggestHit > labBiggestHit) labBiggestHit = d.biggestHit;
    }
    d.update(dt);
    resolveCollision(labFighter, d);
  }

  // Drop dummies that timed out or finished fading, but keep their damage in the totals
  labDummies = labDummies.filter((d) => !d.expired && (d.alive || d.deathFadeTimer > 0));

  updateParticles(dt);
  updateFlashes(dt);
  updateSmokePuffs(dt);
  updateWallCracks(dt);
  updateDamageNumbers(dt);
}

// ---------------------------------------------------------------- panel layout

const LAB_PANEL = { x: 928, y: 92, w: 328, h: 604 };
const LAB_ROW_H = 46;
const LAB_STEP_W = 34;

function labRowRects(row) {
  const y = LAB_PANEL.y + 58 + row * LAB_ROW_H;
  return {
    minus: { x: LAB_PANEL.x + 176, y, w: LAB_STEP_W, h: 30 },
    plus:  { x: LAB_PANEL.x + 282, y, w: LAB_STEP_W, h: 30 },
    labelY: y + 21,
    valueX: LAB_PANEL.x + 245,
  };
}

const LAB_CLEAR_RECT   = { x: LAB_PANEL.x + 16, y: LAB_PANEL.y + 212, w: 140, h: 36 };
const LAB_RESTART_RECT = { x: LAB_PANEL.x + 172, y: LAB_PANEL.y + 212, w: 140, h: 36 };

function labClick(x, y) {
  if (!labFighter) return false;

  const rows = [
    { rects: labRowRects(0), idx: () => labHpIndex,    set: (v) => (labHpIndex = v),    len: LAB_HP_OPTIONS.length },
    { rects: labRowRects(1), idx: () => labDelayIndex, set: (v) => (labDelayIndex = v), len: LAB_DELAY_OPTIONS.length },
    { rects: labRowRects(2), idx: () => labLifeIndex,  set: (v) => (labLifeIndex = v),  len: LAB_LIFE_OPTIONS.length },
  ];
  for (const r of rows) {
    if (pointInRect(x, y, r.rects.minus)) { r.set(Math.max(0, r.idx() - 1)); return true; }
    if (pointInRect(x, y, r.rects.plus))  { r.set(Math.min(r.len - 1, r.idx() + 1)); return true; }
  }

  if (pointInRect(x, y, LAB_CLEAR_RECT)) { labClearDummies(); return true; }
  if (pointInRect(x, y, LAB_RESTART_RECT)) { restartLab(); return true; }

  // anywhere inside the arena drops a dummy, clamped so it can't straddle a wall
  const half = LAB_DUMMY_SIZE / 2;
  const left = ARENA.x + ARENA_BORDER + half;
  const right = ARENA.x + ARENA.w - ARENA_BORDER - half;
  const top = ARENA.y + ARENA_BORDER + half;
  const bottom = ARENA.y + ARENA.h - ARENA_BORDER - half;
  if (x >= ARENA.x && x <= ARENA.x + ARENA.w && y >= ARENA.y && y <= ARENA.y + ARENA.h) {
    labPlaceDummy(
      Math.max(left, Math.min(right, x)),
      Math.max(top, Math.min(bottom, y))
    );
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- drawing

function labDrawButton(ctx, rect, label, accent) {
  ctx.fillStyle = accent ? "rgba(224,176,64,0.18)" : "rgba(255,255,255,0.07)";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = accent ? "#e0b040" : "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = accent ? "#ffdc8c" : "#ffffff";
  ctx.font = "bold 15px Arial";
  ctx.textAlign = "center";
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 5);
}

function labDrawRow(ctx, row, label, valueText) {
  const r = labRowRects(row);
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "14px Arial";
  ctx.fillText(label, LAB_PANEL.x + 16, r.labelY);

  labDrawButton(ctx, r.minus, "-", false);
  labDrawButton(ctx, r.plus, "+", false);

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffdc32";
  ctx.font = "bold 17px Arial";
  ctx.fillText(valueText, r.valueX, r.labelY);
}

// Ghost markers for dummies still waiting out their delay, so a queued placement is visible
function labDrawPending(ctx) {
  for (const p of labPending) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "#e0b040";
    ctx.setLineDash([7, 6]);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, LAB_DUMMY_SIZE / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffdc8c";
    ctx.font = "bold 18px Arial";
    ctx.textAlign = "center";
    ctx.fillText(`${p.countdown.toFixed(1)}s`, p.x, p.y + 6);
    ctx.restore();
  }
}

function labDrawPanel(ctx) {
  ctx.fillStyle = "rgba(16,16,30,0.92)";
  ctx.fillRect(LAB_PANEL.x, LAB_PANEL.y, LAB_PANEL.w, LAB_PANEL.h);
  ctx.strokeStyle = "#3c3c66";
  ctx.lineWidth = 2;
  ctx.strokeRect(LAB_PANEL.x, LAB_PANEL.y, LAB_PANEL.w, LAB_PANEL.h);

  ctx.textAlign = "left";
  ctx.fillStyle = "#ffdc32";
  ctx.font = "bold 20px Arial";
  ctx.fillText("DUMMY SETUP", LAB_PANEL.x + 16, LAB_PANEL.y + 32);

  labDrawRow(ctx, 0, "HP", String(LAB_HP_OPTIONS[labHpIndex]));
  labDrawRow(ctx, 1, "Appears after", `${LAB_DELAY_OPTIONS[labDelayIndex]}s`);
  labDrawRow(ctx, 2, "Lasts for", LAB_LIFE_OPTIONS[labLifeIndex] === 0 ? "until dead" : `${LAB_LIFE_OPTIONS[labLifeIndex]}s`);

  labDrawButton(ctx, LAB_CLEAR_RECT, "Clear", false);
  labDrawButton(ctx, LAB_RESTART_RECT, "Restart", true);

  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = "13px Arial";
  ctx.fillText("Click in the arena to place a dummy", LAB_PANEL.x + 16, LAB_PANEL.y + 272);

  let y = LAB_PANEL.y + 310;
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(LAB_PANEL.x + 16, y - 22);
  ctx.lineTo(LAB_PANEL.x + LAB_PANEL.w - 16, y - 22);
  ctx.stroke();

  ctx.fillStyle = "#ffdc32";
  ctx.font = "bold 18px Arial";
  ctx.fillText(labFighter ? labFighter.name : "-", LAB_PANEL.x + 16, y);
  y += 24;

  ctx.font = "14px Arial";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  const lines = [`Elapsed: ${labClock.toFixed(1)}s`];
  if (labFighter) {
    lines.push(`Speed: ${Math.round(labFighter.speed)}`);
    if (typeof labFighter.attackDamage === "number") lines.push(`Next hit: ${labFighter.attackDamage}`);
    if (typeof labFighter.skillState === "string") lines.push(`State: ${labFighter.skillState}`);
  }
  lines.push(`Damage dealt: ${Math.round(labTotalDamage)}`);
  lines.push(`Hits: ${labTotalHits}`);
  lines.push(`Biggest hit: ${labBiggestHit}`);
  lines.push(`DPS: ${labClock > 0 ? (labTotalDamage / labClock).toFixed(2) : "0.00"}`);
  for (const line of lines) {
    ctx.fillText(line, LAB_PANEL.x + 16, y);
    y += 21;
  }

  const live = labDummies.filter((d) => d.alive);
  if (live.length) {
    y += 6;
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = "13px Arial";
    ctx.fillText(`Live dummies (${live.length})`, LAB_PANEL.x + 16, y);
    y += 20;
    ctx.font = "13px Arial";
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    for (const d of live.slice(0, 5)) {
      ctx.fillText(
        `${Math.ceil(d.hp)}/${d.maxHp}  took ${Math.round(d.damageTaken)} in ${d.hitCount} hit${d.hitCount === 1 ? "" : "s"}`,
        LAB_PANEL.x + 16, y
      );
      y += 19;
    }
  }
}

function labDraw(ctx) {
  if (!labFighter) return;
  for (const d of labDummies) d.draw(ctx);
  labFighter.draw(ctx);
  labDrawPending(ctx);
}
