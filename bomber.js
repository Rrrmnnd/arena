// Bomber: leaves a trail of bombs as it wanders — planting one roots it in place for a beat,
// then each bomb arms and goes off on its own a couple seconds later, no ultimate required.
// The ultimate instead flings a small volley of bombs outward in an arc, landing in a ring
// around itself before they detonate together. Every bomb (regular or ultimate) deals damage
// and launches whoever's caught in the blast. As a bomb's fuse runs low it visibly shakes and
// flickers faster — that tension is the only warning now, there's no range-circle telegraph.
// On death, it goes out with one last delayed blast that can still take the opponent with it.

const BOMBER_MAX_HP           = 125;
const BOMBER_SPEED            = 405;  // Punch Man's base 330 + 75
const BOMBER_SIZE             = CHAR_BASE_SIZE * 1.25; // 1.25x the Demon's size
const BOMBER_PLANT_INTERVAL   = 4.0;  // seconds between dropping a bomb at its current position
const BOMBER_PLANT_ANIM_TIME  = 0.5;  // seconds rooted in place while planting, before it can move again
const BOMBER_BOMB_FUSE_TIME   = 2.0;  // seconds after landing before a bomb detonates on its own
const BOMBER_URGENCY_WINDOW   = 1.0;  // seconds of fuse remaining over which the "about to blow" tension ramps up
const BOMBER_BLAST_INNER_RADIUS = 75;  // within this: the bigger hit
const BOMBER_BLAST_INNER_DAMAGE = 30;
const BOMBER_BLAST_OUTER_RADIUS = 150; // between inner and this: the lesser hit
const BOMBER_BLAST_OUTER_DAMAGE = 20;
const BOMBER_KNOCKBACK_STRENGTH = 700; // px/sec impulse on a base-size (60) target; scales inversely with target size, like the Demon's
const BOMBER_BODY_BLAST_INNER_DAMAGE = 20; // whenever a regular (non-ultimate) bomb detonates, the Bomber's own body detonates too, in sync, hitting the opponent from wherever the Bomber currently stands
const BOMBER_BODY_BLAST_OUTER_DAMAGE = 10;
const BOMBER_BODY_KNOCKBACK_STRENGTH = 500; // the body blast throws them clear too, a bit softer than a bomb's own 700

const BOMBER_SELFDESTRUCT_DELAY  = 0.5; // seconds after death before the last blast actually goes off
const BOMBER_SELFDESTRUCT_RADIUS = 200;
const BOMBER_SELFDESTRUCT_DAMAGE = 30;
const BOMBER_SELFDESTRUCT_PARTICLE_COUNT = 150; // scaled up along with the bigger radius so it still reads as "filled"

const BOMBER_ULTIMATE_CHARGE_TIME  = 30.0; // seconds to fill the ultimate meter (base)
const BOMBER_TAKEN_CHARGE_BONUS    = 0.2;  // charge-seconds gained per point of damage taken while charging
const BOMBER_DEALT_CHARGE_BONUS    = 0.04; // charge-seconds gained per point of damage dealt
const BOMBER_ULTIMATE_INNER_RADIUS = 100; // 4 bombs land here, at the diagonal "corners"
const BOMBER_ULTIMATE_OUTER_RADIUS = 200; // 4 bombs land here, at the cardinal "cross" points
const BOMBER_ULTIMATE_FUSE_TIME    = 2.0;  // seconds after landing before the volley detonates together
const BOMBER_ULTIMATE_THROW_DURATION = 0.4; // seconds each ultimate bomb spends arcing through the air

const BOMBER_CELEBRATE_SPIN_SPEED     = 9;   // radians/sec while celebrating a win
const BOMBER_CELEBRATE_BURST_INTERVAL = 0.15; // seconds between each frantic little victory explosion
const BOMBER_CELEBRATE_BURST_RADIUS   = 55;   // how far from center those bursts can appear

// Pre-drawn bomb art (see web/assets) — the fuse spark is still animated live on top.
const bomberBombImg = new Image();
bomberBombImg.src = "assets/bomber_bomb.png";
const BOMBER_BOMB_IMG_BODY_CENTER_X   = 0.5;
const BOMBER_BOMB_IMG_BODY_CENTER_Y   = 0.62;
const BOMBER_BOMB_IMG_BODY_RADIUS_FRAC = 0.3875;
const BOMBER_BOMB_IMG_FUSE_TIP_X = 0.5625;
const BOMBER_BOMB_IMG_FUSE_TIP_Y = 0.031;

// A bomb's just a landing spot and a fuse. If `flight` is set, it's still airborne — mid-arc
// from where it was thrown to where it'll land — and doesn't start counting its fuse (or
// show any "about to blow" tension) until it touches down.
class Bomb {
  constructor(x, y, fuseTime, flight = null, isUltimate = false) {
    this.x = x;
    this.y = y;
    this.fuseTimer = fuseTime;
    this.flight = flight; // { fromX, fromY, timer, duration } | null
    this.isUltimate = isUltimate; // ultimate-volley bombs don't catch the Bomber in their own blast
  }

  get displayX() {
    if (!this.flight) return this.x;
    const t = 1 - this.flight.timer / this.flight.duration;
    return this.flight.fromX + (this.x - this.flight.fromX) * t;
  }

  get displayY() {
    if (!this.flight) return this.y;
    const t = 1 - this.flight.timer / this.flight.duration;
    const straightY = this.flight.fromY + (this.y - this.flight.fromY) * t;
    return straightY - Math.sin(t * Math.PI) * 70; // arcs up and back down along the way
  }
}

// Scatters particles across the whole disc (not just radiating from the center point), so
// a big blast visually fills its entire radius instead of reading as one small burst.
function spawnRadiusFillParticles(cx, cy, radius, colors, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * radius; // sqrt so density is uniform over the area, not clumped at center
    const px = cx + Math.cos(angle) * dist;
    const py = cy + Math.sin(angle) * dist;
    const color = colors[Math.floor(Math.random() * colors.length)];
    particles.push(new Particle(px, py, color, 1, 80));
  }
}

// `urgency` (0..1) is how close to detonation this bomb is — 0 while freshly landed, ramping
// to 1 right before it blows. Drives an escalating shake, pulse, and fuse-flicker speed;
// there's no range-circle telegraph anymore, so this tension is the only warning.
function drawBomb(ctx, x, y, scale = 1, urgency = 0) {
  const shakeMag = urgency * 4;
  const drawX = x + (shakeMag > 0 ? (Math.random() * 2 - 1) * shakeMag : 0);
  const drawY = y + (shakeMag > 0 ? (Math.random() * 2 - 1) * shakeMag : 0);

  if (urgency > 0) {
    const t = performance.now() / 1000;
    const glowPulse = 0.35 + Math.sin(t * (10 + urgency * 20)) * 0.15;
    ctx.save();
    ctx.globalAlpha = urgency * glowPulse;
    ctx.fillStyle = "#ff2818";
    ctx.beginPath();
    ctx.arc(drawX, drawY, 17 * scale * 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (!bomberBombImg.complete || bomberBombImg.naturalWidth === 0) return;

  const pulse = 1 + Math.sin(performance.now() / 1000 * (6 + urgency * 16)) * urgency * 0.1;
  const bodyRadius = 17 * scale * pulse;
  const dw = bodyRadius / BOMBER_BOMB_IMG_BODY_RADIUS_FRAC;
  const dh = dw * (bomberBombImg.naturalHeight / bomberBombImg.naturalWidth);
  const offsetX = -BOMBER_BOMB_IMG_BODY_CENTER_X * dw;
  const offsetY = -BOMBER_BOMB_IMG_BODY_CENTER_Y * dh;

  ctx.save();
  ctx.translate(drawX, drawY);
  ctx.drawImage(bomberBombImg, offsetX, offsetY, dw, dh);
  ctx.restore();

  // Animated spark at the fuse tip, layered on top of the static art — flickers faster
  // as the fuse burns down.
  const sparkX = drawX + offsetX + BOMBER_BOMB_IMG_FUSE_TIP_X * dw;
  const sparkY = drawY + offsetY + BOMBER_BOMB_IMG_FUSE_TIP_Y * dh;
  const flickerSpeed = 14 + urgency * 22;
  const t = performance.now() / 1000;
  ctx.fillStyle = "#ffcf6b";
  ctx.beginPath();
  ctx.arc(sparkX, sparkY, (2.5 + Math.sin(t * flickerSpeed) * 1) * scale, 0, Math.PI * 2);
  ctx.fill();
}

class Bomber extends Character {
  constructor(x, y) {
    super({
      x, y,
      size: BOMBER_SIZE,
      color: "#2b2b30",
      maxHp: BOMBER_MAX_HP,
      name: "Bomber",
      speed: BOMBER_SPEED,
    });

    this.plantTimer = 0;
    this.plantAnimTimer = 0; // >0 while rooted in place, mid-planting-animation
    this.bombs = []; // every bomb on the field: in flight, armed and ticking, or about to detonate

    this.chargeTime = 0;
    this.lastOpponentRef = null; // cached each frame so onDeath() (which takes no args) can still reach the opponent
    this.selfDestructTimer = 0; // >0 after death, counting down to the delayed final blast

    this.celebrating = false; // true once it's won: spins in place while setting off little victory explosions
    this.celebrateSpin = 0;
    this.celebrateBurstTimer = 0;
  }

  onVictory() {
    this.celebrating = true;
    this.celebrateSpin = 0;
    this.celebrateBurstTimer = 0;
  }

  // Doesn't blow immediately — starts a short fuse of its own instead, so the body has a
  // beat to visibly shake before it goes.
  onDeath() {
    this.deathFadeTimer = BOMBER_SELFDESTRUCT_DELAY;
    this.selfDestructTimer = BOMBER_SELFDESTRUCT_DELAY;
  }

  // The delayed payoff of onDeath(): one last blast at the spot it died, potentially taking
  // the opponent down too for a draw.
  triggerSelfDestruct(opponent) {
    if (opponent && opponent.alive) {
      const dist = Math.hypot(opponent.x - this.x, opponent.y - this.y);
      if (dist <= BOMBER_SELFDESTRUCT_RADIUS + opponent.size / 2) {
        opponent.takeDamage(BOMBER_SELFDESTRUCT_DAMAGE);
      }
    }

    spawnRadiusFillParticles(this.x, this.y, BOMBER_SELFDESTRUCT_RADIUS, ["#ffcf6b", "#ff8c30", "#ff3c1c", "#ffffff", "#888888"], BOMBER_SELFDESTRUCT_PARTICLE_COUNT);
    spawnFlash(this.x, this.y, "#ffa030", BOMBER_SELFDESTRUCT_RADIUS, 0.5);
    triggerShake(10, 0.35);
    playSfx("bomberExplode", 0.8);
  }

  takeDamage(dmg, colorOverride = null) {
    super.takeDamage(dmg, colorOverride);
    if (dmg > 0 && this.alive) {
      this.chargeTime = Math.min(BOMBER_ULTIMATE_CHARGE_TIME, this.chargeTime + dmg * BOMBER_TAKEN_CHARGE_BONUS);
    }
  }

  // The mirror of the bonus above: every point it lands also brings its own ultimate forward.
  // Applies to bomb blasts, its own body blast, and the ultimate's bombs alike.
  creditDamageDealt(dmg) {
    if (dmg > 0 && this.alive) {
      this.chargeTime = Math.min(BOMBER_ULTIMATE_CHARGE_TIME, this.chargeTime + dmg * BOMBER_DEALT_CHARGE_BONUS);
    }
  }

  update(dt, opponent) {
    this.lastOpponentRef = opponent; // kept fresh so onDeath()/self-destruct can still find the opponent
    super.update(dt, opponent);

    if (!this.alive) {
      this.updateBombs(dt, opponent);
      if (this.selfDestructTimer > 0) {
        this.selfDestructTimer -= dt;
        if (this.selfDestructTimer <= 0) this.triggerSelfDestruct(opponent);
      }
      return;
    }
    if (this.stunTimer > 0) { this.updateBombs(dt, opponent); return; }

    if (this.celebrating) {
      this.updateBombs(dt, opponent); // any bombs already ticking down still play out normally
      this.celebrateSpin += dt * BOMBER_CELEBRATE_SPIN_SPEED;
      this.celebrateBurstTimer -= dt;
      if (this.celebrateBurstTimer <= 0) {
        this.celebrateBurstTimer = BOMBER_CELEBRATE_BURST_INTERVAL;
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * BOMBER_CELEBRATE_BURST_RADIUS;
        const bx = this.x + Math.cos(angle) * dist;
        const by = this.y + Math.sin(angle) * dist;
        spawnImpactParticles(bx, by, ["#ffcf6b", "#ff8c30", "#ff3c1c", "#ffffff"], 20, 1.2, 100);
        spawnFlash(bx, by, "#ffa030", 50, 0.25);
        triggerShake(3, 0.15);
        playSfx("bomberExplode", 0.4);
      }
      return;
    }

    if (this.plantAnimTimer > 0) {
      this.plantAnimTimer -= dt;
      if (this.plantAnimTimer <= 0) {
        this.movable = true;
        const angle = Math.random() * Math.PI * 2; // was zeroed out to root it in place — needs a fresh heading to actually move again
        this.vx = Math.cos(angle) * this.speed;
        this.vy = Math.sin(angle) * this.speed;
        this.bombs.push(new Bomb(this.x, this.y, BOMBER_BOMB_FUSE_TIME));
        playSfx("bomberPlant", 0.4);
      }
    } else {
      if (this.plantTimer > 0) this.plantTimer -= dt;
      if (this.canAttack && this.plantTimer <= 0) {
        this.plantAnimTimer = BOMBER_PLANT_ANIM_TIME;
        this.movable = false;
        this.vx = 0;
        this.vy = 0;
        this.plantTimer += BOMBER_PLANT_INTERVAL;
      }
    }

    this.updateBombs(dt, opponent);

    this.chargeTime += dt;
    if (this.chargeTime >= BOMBER_ULTIMATE_CHARGE_TIME) {
      this.triggerUltimate();
      this.chargeTime = 0;
    }
  }

  // In-flight bombs just arc toward their landing spot; only once landed do they start
  // ticking their fuse down toward detonation.
  updateBombs(dt, opponent) {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const bomb = this.bombs[i];

      if (bomb.flight) {
        bomb.flight.timer -= dt;
        if (bomb.flight.timer <= 0) bomb.flight = null; // landed — starts arming next frame
        continue;
      }

      bomb.fuseTimer -= dt;
      if (bomb.fuseTimer <= 0) {
        this.detonateBomb(bomb, opponent);
        this.bombs.splice(i, 1);
      }
    }
  }

  // Flings 6 bombs outward in an arc: 3 to the inner radius (30/150/270deg), 3 to the outer
  // radius (90/210/330deg) — each ring is evenly spaced 120deg apart, and the two rings are
  // offset 60deg from each other so together they interleave into a 6-point star. Clamped
  // inside the arena so none of them land in the void outside the walls.
  triggerUltimate() {
    const half = 10;
    const left = ARENA.x + ARENA_BORDER + half;
    const right = ARENA.x + ARENA.w - ARENA_BORDER - half;
    const top = ARENA.y + ARENA_BORDER + half;
    const bottom = ARENA.y + ARENA.h - ARENA_BORDER - half;

    const fromX = this.x;
    const fromY = this.y;

    const layout = [
      { angleDeg: 30, radius: BOMBER_ULTIMATE_INNER_RADIUS },
      { angleDeg: 150, radius: BOMBER_ULTIMATE_INNER_RADIUS },
      { angleDeg: 270, radius: BOMBER_ULTIMATE_INNER_RADIUS },
      { angleDeg: 90, radius: BOMBER_ULTIMATE_OUTER_RADIUS },
      { angleDeg: 210, radius: BOMBER_ULTIMATE_OUTER_RADIUS },
      { angleDeg: 330, radius: BOMBER_ULTIMATE_OUTER_RADIUS },
    ];

    for (const spot of layout) {
      const angle = spot.angleDeg * Math.PI / 180;
      const bx = Math.min(right, Math.max(left, this.x + Math.cos(angle) * spot.radius));
      const by = Math.min(bottom, Math.max(top, this.y + Math.sin(angle) * spot.radius));
      this.bombs.push(new Bomb(bx, by, BOMBER_ULTIMATE_FUSE_TIME, {
        fromX, fromY, timer: BOMBER_ULTIMATE_THROW_DURATION, duration: BOMBER_ULTIMATE_THROW_DURATION,
      }, true)); // isUltimate — doesn't catch the Bomber in its own blast
    }
    playSfx("bomberUltimate", 0.7);
  }

  detonateBomb(bomb, opponent) {
    if (opponent && opponent.alive) {
      const dist = Math.hypot(opponent.x - bomb.x, opponent.y - bomb.y);
      const innerR = BOMBER_BLAST_INNER_RADIUS + opponent.size / 2;
      const outerR = BOMBER_BLAST_OUTER_RADIUS + opponent.size / 2;
      if (dist <= outerR) {
        const dmg = dist <= innerR ? BOMBER_BLAST_INNER_DAMAGE : BOMBER_BLAST_OUTER_DAMAGE;
        opponent.takeDamage(dmg);
        this.creditDamageDealt(dmg);

        const hasDir = dist > 0.01;
        const angle = hasDir ? Math.atan2(opponent.y - bomb.y, opponent.x - bomb.x) : Math.random() * Math.PI * 2;
        const kb = BOMBER_KNOCKBACK_STRENGTH * (CHAR_BASE_SIZE / opponent.size);
        opponent.applyKnockback(Math.cos(angle), Math.sin(angle), kb);
      }
    }

    // Whenever a regular (non-ultimate) bomb detonates anywhere on the field, the Bomber's
    // own body detonates too, in sync — a second, smaller blast centered on wherever the
    // Bomber currently is (not the bomb's landing spot), hitting the opponent if they're
    // caught in it. bodyBlastUrgency (see the getter) telegraphs this on the Bomber's body
    // in the run-up, using whichever live bomb is closest to going off.
    if (!bomb.isUltimate && this.alive && opponent && opponent.alive) {
      const bodyDist = Math.hypot(opponent.x - this.x, opponent.y - this.y);
      const bodyInnerR = BOMBER_BLAST_INNER_RADIUS + opponent.size / 2;
      const bodyOuterR = BOMBER_BLAST_OUTER_RADIUS + opponent.size / 2;
      if (bodyDist <= bodyOuterR) {
        const bodyDmg = bodyDist <= bodyInnerR ? BOMBER_BODY_BLAST_INNER_DAMAGE : BOMBER_BODY_BLAST_OUTER_DAMAGE;
        opponent.takeDamage(bodyDmg);
        this.creditDamageDealt(bodyDmg);

        // Blows them away from the Bomber, same as a bomb's own blast does — without this the
        // body explosion just quietly drained HP with no sense of impact.
        const hasDir = bodyDist > 0.01;
        const angle = hasDir ? Math.atan2(opponent.y - this.y, opponent.x - this.x) : Math.random() * Math.PI * 2;
        const kb = BOMBER_BODY_KNOCKBACK_STRENGTH * (CHAR_BASE_SIZE / opponent.size);
        opponent.applyKnockback(Math.cos(angle), Math.sin(angle), kb);
      }
      spawnRadiusFillParticles(this.x, this.y, BOMBER_BLAST_OUTER_RADIUS, ["#ff3c1c", "#ffcf6b", "#ffffff"], 55);
      spawnFlash(this.x, this.y, "#ff5030", 85, 0.3);
      triggerShake(5, 0.2);
    }

    spawnRadiusFillParticles(bomb.x, bomb.y, BOMBER_BLAST_OUTER_RADIUS, ["#ffcf6b", "#ff8c30", "#ff3c1c", "#ffffff"], 70);
    spawnFlash(bomb.x, bomb.y, "#ffa030", 95, 0.35);
    triggerShake(7, 0.22);
    playSfx("bomberExplode", 0.65);
  }

  drawBombs(ctx) {
    for (const bomb of this.bombs) {
      if (bomb.flight) {
        drawBomb(ctx, bomb.displayX, bomb.displayY, 1, 0); // mid-arc, no urgency yet
      } else {
        const urgency = Math.max(0, Math.min(1, 1 - bomb.fuseTimer / BOMBER_URGENCY_WINDOW));
        drawBomb(ctx, bomb.x, bomb.y, 1, urgency);
      }
    }
  }

  // 0..1 — how close the nearest live regular (non-ultimate, already-landed) bomb is to
  // detonating. Drives the pre-explosion telegraph on the Bomber's own body (see drawBody)
  // for the synced body-blast in detonateBomb, the same "about to blow" language as an
  // individual bomb's own fuse.
  get bodyBlastUrgency() {
    let minFuse = Infinity;
    for (const bomb of this.bombs) {
      if (!bomb.flight && !bomb.isUltimate) minFuse = Math.min(minFuse, bomb.fuseTimer);
    }
    if (minFuse === Infinity) return 0;
    return Math.max(0, Math.min(1, 1 - minFuse / BOMBER_URGENCY_WINDOW));
  }

  // The bomb growing into place at its feet while it's rooted mid-plant.
  drawPlantingAnim(ctx) {
    if (this.plantAnimTimer <= 0) return;
    const progress = 1 - this.plantAnimTimer / BOMBER_PLANT_ANIM_TIME; // 0 -> 1
    drawBomb(ctx, this.x, this.y, Math.max(0.05, progress), 0);
  }

  // Round bomb-like body: dark metal shell, a lit fuse, a glass highlight, glowing eyes.
  // Squashes down briefly while planting; shakes with rising intensity during its own
  // self-destruct countdown after death; spins in place while celebrating a win.
  drawBody(ctx) {
    const s = this.size;
    let jx = 0, jy = 0;
    const deathUrgency = (!this.alive && this.selfDestructTimer > 0)
      ? Math.max(0, 1 - this.selfDestructTimer / BOMBER_SELFDESTRUCT_DELAY)
      : 0;
    const blastUrgency = this.alive ? this.bodyBlastUrgency : 0;
    const urgency = Math.max(deathUrgency, blastUrgency);
    if (urgency > 0) {
      const shakeMag = urgency * 5;
      jx = (Math.random() * 2 - 1) * shakeMag;
      jy = (Math.random() * 2 - 1) * shakeMag;
    }

    ctx.save();
    ctx.translate(this.x + jx, this.y + jy);
    if (this.celebrating) ctx.rotate(this.celebrateSpin);

    if (blastUrgency > 0) {
      // Same glow-pulse language as an individual bomb's own fuse tension (see drawBomb),
      // but on the Bomber's whole body — telegraphs the synced body-blast building up
      // toward whichever live bomb is closest to detonating.
      const glowT = performance.now() / 1000;
      const glowPulse = 0.35 + Math.sin(glowT * (10 + blastUrgency * 20)) * 0.15;
      ctx.save();
      ctx.globalAlpha = blastUrgency * glowPulse;
      ctx.fillStyle = "#ff2818";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (this.plantAnimTimer > 0) {
      const squish = Math.sin((1 - this.plantAnimTimer / BOMBER_PLANT_ANIM_TIME) * Math.PI) * 0.18;
      ctx.scale(1 + squish, 1 - squish);
    }

    const t = performance.now() / 1000;
    ctx.strokeStyle = "#7a5230";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -s / 2);
    ctx.quadraticCurveTo(s * 0.18, -s * 0.7, s * 0.05, -s * 0.85);
    ctx.stroke();

    ctx.fillStyle = "#ffcf6b";
    ctx.beginPath();
    ctx.arc(s * 0.05, -s * 0.85, 4 + Math.sin(t * 14) * 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.arc(-s * 0.15, -s * 0.15, s * 0.18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ff5030";
    ctx.beginPath();
    ctx.arc(-s * 0.14, s * 0.05, s * 0.07, 0, Math.PI * 2);
    ctx.arc(s * 0.14, s * 0.05, s * 0.07, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  draw(ctx) {
    this.drawBombs(ctx); // drawn even after death so any bombs already on the field can still be seen ticking down
    if (!this.alive && this.deathFadeTimer <= 0) return;
    super.draw(ctx);
    this.drawPlantingAnim(ctx);
  }

  get ultimateRatio() {
    return Math.min(1, this.chargeTime / BOMBER_ULTIMATE_CHARGE_TIME);
  }

  get ultimateBarColor() {
    return "#ff8c30";
  }

  // No drawHud override: the HUD is deliberately just name + HP bar + ultimate bar for every
  // character. The ability/cooldown readouts that used to sit under it are gone.
}
