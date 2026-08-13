// Gunner: fires whatever weapon it's currently holding at the opponent's current position
// (straight line, no homing — same "might just miss" logic as the Demon's tridents), and
// permanently evolves to the next weapon once its own evolve-meter fills. That meter charges
// over time and gets a boost from landing hits — dealing 1 damage shaves 0.2s off it,
// regardless of which weapon dealt it. Evolution is one-way and never resets mid-round.
//
// The final tier, Laser Cannon, doesn't evolve further and doesn't fire discrete bullets —
// it's a continuous beam (width = the Gunner's own diameter) ticking damage every 0.25s,
// forever, for as long as it stays the current tier. It also doesn't snap straight to full
// width: right when it's reached, the beam grows in from nothing over half a second.

const GUNNER_SIZE  = CHAR_BASE_SIZE; // same size as Punch Man
const GUNNER_MAX_HP = 110; // placeholder — not specified, tune after testing
const GUNNER_SPEED  = 300; // placeholder — not specified, tune after testing
const GUNNER_BULLET_SPEED = 1000; // px/sec while a bullet is in flight
const GUNNER_DEALT_CHARGE_BONUS = 0.2; // evolve-seconds shaved off per point of damage a bullet actually lands
const GUNNER_LASER_GROW_DURATION = 0.5; // seconds for the beam to grow from nothing to full width after evolving into it
const GUNNER_LASER_FIRE_DURATION = 6.84; // seconds the beam fires before overheating — matches the length of the gunnerLaser sfx clip
const GUNNER_LASER_OVERHEAT_DURATION = 3.5; // seconds the weapon is disabled after a firing cycle ends
const GUNNER_ROCKET_EXPLOSION_RADIUS = 150; // splash radius when a rocket detonates
const GUNNER_ROCKET_SPLASH_DAMAGE = 15; // damage to anyone caught in the blast who wasn't the direct hit
const GUNNER_ROCKET_RECOIL_STRENGTH = 200; // px/sec knockback impulse kicking the soldier backward on each shot

function gunnerLerp(a, b, t) {
  return a + (b - a) * t;
}

// Each bullet tier: how fast it fires (shots/sec), damage per shot, and how long (seconds,
// plus the damage-dealt bonus above) until it permanently evolves into the next one. The
// final entry is the beam tier instead (see isBeam below) and has no evolveTime — it's the
// last stop. Every tier fires continuously at its own fireRate — no burst pauses.
const GUNNER_WEAPON_TIERS = [
  { name: "Pistol", fireRate: 2,     damage: 1,  evolveTime: 10.0 },
  { name: "SMG",     fireRate: 5.5,  damage: 1,  evolveTime: 15.0 },
  { name: "Rifle",   fireRate: 3,    damage: 5,  evolveTime: 18.0 },
  { name: "Rocket Launcher", fireRate: 0.25, damage: 25, evolveTime: 20.0 },
  { name: "Laser Cannon", isBeam: true, tickDamage: 6, tickInterval: 0.25 },
];

// Each gun has its own firing sound (the generic "gunnerShoot" placeholder was never backed
// by an actual sfx file, so it played silently) — Laser Cannon doesn't fire discrete shots so
// it has no entry here yet.
const GUNNER_SHOOT_SFX = {
  "Pistol": "gunnerPistol",
  "SMG": "gunnerSmg",
  "Rifle": "gunnerRifle",
  "Rocket Launcher": "gunnerRocketFire",
};

// Pre-drawn weapon art (see web/assets). Every sprite is drawn pointing along +x with its
// grip anchored at a consistent fraction of its own canvas, so they all rotate/position the
// same way regardless of how big or oddly-shaped the weapon itself is.
const GUNNER_WEAPON_GRIP_FRAC_X = 0.15;
const GUNNER_WEAPON_GRIP_FRAC_Y = 0.5;

// muzzleOffset is how far along the aim direction the weapon's own muzzle sits, measured
// from the character's center (the grip anchor) — used so bullets/beams spawn at the gun's
// tip instead of from inside the character's body.
function makeWeaponImage(src, displayWidth) {
  const img = new Image();
  img.src = src;
  return { img, displayWidth, muzzleOffset: (1 - GUNNER_WEAPON_GRIP_FRAC_X) * displayWidth };
}

const GUNNER_WEAPON_IMAGES = {
  "Pistol": makeWeaponImage("assets/gunner_pistol.png?v=4", 62),
  "SMG": makeWeaponImage("assets/gunner_smg.png?v=4", 109),
  "Rifle": makeWeaponImage("assets/gunner_rifle.png?v=4", 118),
  "Rocket Launcher": makeWeaponImage("assets/gunner_rocket_launcher.png?v=4", 195), // bulked up — bigger and more imposing, as requested
  "Laser Cannon": makeWeaponImage("assets/gunner_laser_cannon.png?v=5", 100),
};

// Bullets are also pre-drawn art, anchored near their front tip (fraction along their own
// width) so a bullet's (x,y) lines up with its leading edge, matching how the hit-check
// already treats bullet position as the point of impact.
const GUNNER_BULLET_TIP_FRACTION = 0.92;

function makeBulletImage(src, displayWidth) {
  const img = new Image();
  img.src = src;
  return { img, displayWidth };
}

const GUNNER_BULLET_IMAGES = {
  "Pistol": makeBulletImage("assets/gunner_bullet_small.png", 22),
  "SMG": makeBulletImage("assets/gunner_bullet_small.png", 20),
  "Rifle": makeBulletImage("assets/gunner_bullet_rifle.png", 30),
  "Rocket Launcher": makeBulletImage("assets/gunner_rocket.png", 60), // bigger, as requested
};

class Bullet {
  constructor(x, y, angle, damage, weaponName) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.vx = Math.cos(angle) * GUNNER_BULLET_SPEED;
    this.vy = Math.sin(angle) * GUNNER_BULLET_SPEED;
    this.damage = damage;
    this.weaponName = weaponName;
    this.life = 1.5; // safety timeout in case it somehow never leaves the arena
  }
}

function drawBullet(ctx, b) {
  const info = GUNNER_BULLET_IMAGES[b.weaponName];
  if (!info || !info.img.complete || info.img.naturalWidth === 0) return;

  const dw = info.displayWidth;
  const dh = dw * (info.img.naturalHeight / info.img.naturalWidth);

  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.angle);
  ctx.drawImage(info.img, -dw * GUNNER_BULLET_TIP_FRACTION, -dh / 2, dw, dh);
  ctx.restore();
}

class Gunner extends Character {
  constructor(x, y) {
    super({
      x, y,
      size: GUNNER_SIZE,
      color: "#4a6741",
      maxHp: GUNNER_MAX_HP,
      name: "Soldier",
      speed: GUNNER_SPEED,
    });

    this.tierIndex = 0; // index into GUNNER_WEAPON_TIERS — only ever goes up
    this.evolveCharge = 0; // seconds charged toward evolving out of the current tier
    this.attackTimer = 0;
    this.aimAngle = 0;
    this.bullets = [];
    this.beamTickTimer = 0; // counts down to the next damage tick while wielding the Laser Cannon
    this.laserGrowTimer = 0; // >0 right after evolving into the Laser Cannon: beam is still growing in
    this.laserTime = 0; // running clock for the beam's idle pulse/traveling-energy animation
    this.laserFireTimer = 0; // seconds left in the current firing cycle before it overheats
    this.laserOverheated = false; // true while disabled and cooling down between firing cycles
    this.laserOverheatTimer = 0; // seconds left until the beam can fire again
    this.laserAudioSource = null; // the currently-playing gunnerLaser clip, if any — stopped/resumed
                                   // around stun so the sound never keeps going after the fight logic pauses
    this.laserSparkTimer = 0; // counts down to the next little energy-spark particle along the beam
  }

  get tier() {
    return GUNNER_WEAPON_TIERS[this.tierIndex];
  }

  get isFinalTier() {
    return this.tierIndex >= GUNNER_WEAPON_TIERS.length - 1;
  }

  get isLaserTier() {
    return !!this.tier.isBeam;
  }

  // Where the currently-held weapon's muzzle actually sits, so bullets/beams originate from
  // the gun's tip rather than from the character's own center.
  getMuzzlePoint() {
    const weaponInfo = GUNNER_WEAPON_IMAGES[this.tier.name];
    const offset = weaponInfo ? weaponInfo.muzzleOffset : 0;
    return {
      x: this.x + Math.cos(this.aimAngle) * offset,
      y: this.y + Math.sin(this.aimAngle) * offset,
    };
  }

  // 0..1 — how "grown in" the beam currently is; 1 once the grow-in window has passed.
  get laserWidthProgress() {
    if (!this.isLaserTier) return 1;
    if (this.laserGrowTimer <= 0) return 1;
    return Math.max(0, 1 - this.laserGrowTimer / GUNNER_LASER_GROW_DURATION);
  }

  onVictory() {
    playSfx("gunnerWin", 0.7, 0);
  }

  update(dt, opponent) {
    super.update(dt, opponent);
    // A dead soldier shouldn't keep a beam sound going, and getting stunned mid-beam pauses
    // the fire-cycle timer below — so the sound has to pause right along with it, or it'd
    // finish playing (in real time) well before the paused timer says the cycle is over.
    if (!this.alive || this.stunTimer > 0) {
      this.stopLaserAudio();
      this.updateBullets(dt, opponent);
      return;
    }

    if (opponent && opponent.alive) {
      this.aimAngle = Math.atan2(opponent.y - this.y, opponent.x - this.x);
    }

    if (this.isLaserTier) {
      if (this.canAttack) this.updateLaser(dt, opponent);
    } else {
      if (this.attackTimer > 0) this.attackTimer -= dt;
      if (this.canAttack && opponent && opponent.alive && this.attackTimer <= 0) {
        const muzzle = this.getMuzzlePoint();
        this.bullets.push(new Bullet(muzzle.x, muzzle.y, this.aimAngle, this.tier.damage, this.tier.name));
        playSfx(GUNNER_SHOOT_SFX[this.tier.name], this.tier.name === "Rocket Launcher" ? 0.5 : 0.45);
        if (this.tier.name === "Rocket Launcher") {
          this.applyKnockback(-Math.cos(this.aimAngle), -Math.sin(this.aimAngle), GUNNER_ROCKET_RECOIL_STRENGTH);
        }
        this.attackTimer += 1 / this.tier.fireRate;
      }

      if (!this.isFinalTier) {
        this.evolveCharge += dt;
        if (this.evolveCharge >= this.tier.evolveTime) this.evolveWeapon();
      }
    }

    this.updateBullets(dt, opponent); // always runs, so any leftover shots from the previous tier still resolve
  }

  // Starts (or resumes, from `offsetSeconds` into the clip) the beam's firing sound, keeping
  // a handle to it so it can be cut off early — around a stun, or if the soldier dies.
  playLaserAudio(offsetSeconds) {
    this.laserAudioSource = playSfx("gunnerLaser", 0.5, 0, offsetSeconds);
  }

  stopLaserAudio() {
    if (!this.laserAudioSource) return;
    try { this.laserAudioSource.stop(); } catch (e) { /* already finished on its own */ }
    this.laserAudioSource = null;
  }

  // Fires for GUNNER_LASER_FIRE_DURATION (matching the gunnerLaser sfx clip), then overheats
  // and goes silent/harmless for GUNNER_LASER_OVERHEAT_DURATION before spinning back up and
  // repeating. Getting stunned mid-cycle freezes laserFireTimer (update() skips this method
  // entirely while stunned) and stops the sound; once unstunned, the sound picks back up from
  // wherever the timer says it should be, so the two always stay in sync.
  updateLaser(dt, opponent) {
    this.laserTime += dt;

    if (this.laserOverheated) {
      this.laserOverheatTimer -= dt;
      if (this.laserOverheatTimer <= 0) {
        this.laserOverheated = false;
        this.laserFireTimer = GUNNER_LASER_FIRE_DURATION;
        this.laserGrowTimer = GUNNER_LASER_GROW_DURATION;
        this.beamTickTimer = 0;
      }
      return;
    }

    if (!this.laserAudioSource) {
      this.playLaserAudio(GUNNER_LASER_FIRE_DURATION - this.laserFireTimer);
      // A little charge-up flash right at the muzzle each time the beam spins up — not just
      // the very first evolution — so every firing cycle gets the same visual "kick".
      const muzzle = this.getMuzzlePoint();
      spawnFlash(muzzle.x, muzzle.y, "#a0e8ff", 40, 0.25);
      spawnImpactParticles(muzzle.x, muzzle.y, ["#a0e8ff", "#ffffff", "#c8a0ff"], 10, 0.9, 0);
    }

    if (this.laserGrowTimer > 0) this.laserGrowTimer -= dt;

    this.laserFireTimer -= dt;
    if (this.laserFireTimer <= 0) {
      this.laserOverheated = true;
      this.laserOverheatTimer = GUNNER_LASER_OVERHEAT_DURATION;
      this.stopLaserAudio();
      // Vent puff marking the power-down, so overheating reads as an event rather than the
      // beam just silently vanishing.
      const muzzle = this.getMuzzlePoint();
      spawnImpactParticles(muzzle.x, muzzle.y, ["#ffb090", "#cccccc", "#888888"], 14, 1.1, -30);
      return;
    }

    // A steady trickle of small sparks along the currently-visible beam length, so it reads
    // as an active energy stream rather than a flat static shape.
    this.laserSparkTimer -= dt;
    if (this.laserSparkTimer <= 0) {
      this.laserSparkTimer = 0.07;
      const muzzle = this.getMuzzlePoint();
      const { halfWidth, halfLength } = this.laserShape;
      const along = Math.random() * halfLength * 2;
      const perp = (Math.random() * 2 - 1) * halfWidth * 0.8;
      const sx = muzzle.x + Math.cos(this.aimAngle) * along - Math.sin(this.aimAngle) * perp;
      const sy = muzzle.y + Math.sin(this.aimAngle) * along + Math.cos(this.aimAngle) * perp;
      spawnImpactParticles(sx, sy, ["#a0e8ff", "#ffffff", "#c8a0ff"], 2, 0.45, 0);
    }

    this.beamTickTimer -= dt;
    if (this.beamTickTimer > 0) return;
    this.beamTickTimer += this.tier.tickInterval;
    if (opponent && opponent.alive && this.beamHits(opponent)) {
      opponent.takeDamage(this.tier.tickDamage);
    }
  }

  // How far the beam currently reaches and how thick it currently is — both start tiny (a
  // round blob right at the muzzle) and grow out into the full-length, full-width beam over
  // GUNNER_LASER_GROW_DURATION. The length grows in slower than the width at first (ease
  // exponent > 1) so it visibly starts as a small oval and stretches into a beam afterward.
  get laserShape() {
    const growT = this.laserWidthProgress;
    const halfWidth = gunnerLerp(4, this.size / 2, growT);
    const halfLength = gunnerLerp(4, 1100, Math.pow(growT, 1.6));
    return { halfWidth, halfLength };
  }

  // Whether `target` currently sits inside the beam: a lane extending forward from the
  // Gunner's aim direction, capped to however far the beam has currently grown out to.
  beamHits(target) {
    const muzzle = this.getMuzzlePoint();
    const dx = target.x - muzzle.x;
    const dy = target.y - muzzle.y;
    const along = dx * Math.cos(this.aimAngle) + dy * Math.sin(this.aimAngle);
    if (along < 0) return false; // behind the Gunner
    const { halfWidth, halfLength } = this.laserShape;
    if (along > halfLength * 2) return false; // hasn't grown out this far yet
    const perp = Math.abs(dx * Math.sin(this.aimAngle) - dy * Math.cos(this.aimAngle));
    return perp <= halfWidth + target.size / 2;
  }

  updateBullets(dt, opponent) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      let gone = b.life <= 0 || b.x < ARENA.x || b.x > ARENA.x + ARENA.w || b.y < ARENA.y || b.y > ARENA.y + ARENA.h;
      let directHit = false;

      if (!gone && opponent && opponent.alive) {
        const dist = Math.hypot(opponent.x - b.x, opponent.y - b.y);
        if (dist <= opponent.size / 2 + 5) {
          directHit = true;
          gone = true;
        }
      }

      if (gone) {
        if (b.weaponName === "Rocket Launcher") {
          this.explodeRocket(b, opponent, directHit);
        } else if (directHit) {
          opponent.takeDamage(b.damage);
          if (!this.isFinalTier) this.evolveCharge += b.damage * GUNNER_DEALT_CHARGE_BONUS;
        }
        this.bullets.splice(i, 1);
      }
    }
  }

  // A rocket always detonates when it stops flying: a direct hit still deals its full listed
  // damage, but slamming into the arena wall (or timing out) instead deals a smaller splash
  // to the opponent if they're still caught inside the blast radius.
  explodeRocket(b, opponent, directHit) {
    spawnFlash(b.x, b.y, "#ffaa55", GUNNER_ROCKET_EXPLOSION_RADIUS, 0.4);
    spawnImpactParticles(b.x, b.y, ["#ffcc66", "#ff6633", "#443322", "#999999"], 30, 2.4, 40);
    triggerShake(7, 0.3);
    playSfx("gunnerRocketExplode", 0.6);

    if (directHit) {
      if (opponent && opponent.alive) {
        opponent.takeDamage(b.damage);
        if (!this.isFinalTier) this.evolveCharge += b.damage * GUNNER_DEALT_CHARGE_BONUS;
      }
      return;
    }

    if (opponent && opponent.alive) {
      const dist = Math.hypot(opponent.x - b.x, opponent.y - b.y);
      if (dist <= GUNNER_ROCKET_EXPLOSION_RADIUS + opponent.size / 2) {
        opponent.takeDamage(GUNNER_ROCKET_SPLASH_DAMAGE);
        if (!this.isFinalTier) this.evolveCharge += GUNNER_ROCKET_SPLASH_DAMAGE * GUNNER_DEALT_CHARGE_BONUS;
      }
    }
  }

  // Permanently moves to the next weapon tier — this never reverts or resets mid-round.
  evolveWeapon() {
    this.tierIndex = Math.min(GUNNER_WEAPON_TIERS.length - 1, this.tierIndex + 1);
    this.evolveCharge = 0;
    if (this.tier.isBeam) {
      this.laserGrowTimer = GUNNER_LASER_GROW_DURATION;
      this.laserFireTimer = GUNNER_LASER_FIRE_DURATION;
      this.laserOverheated = false;
      // The firing sound itself starts lazily from updateLaser() next frame (offset 0, since
      // laserFireTimer is freshly full) — that single code path also handles resuming after
      // a stun, so there's no separate "start" call to keep in sync here.
    }
    spawnFlash(this.x, this.y, "#ffffff", 70, 0.3);
    spawnImpactParticles(this.x, this.y, ["#ffe066", "#ffffff", "#a0e0ff"], 24, 1.3, 0);
    triggerShake(4, 0.2);
    playSfx("gunnerUltimate", 0.5); // "gunnerEvolve" was never backed by a real sfx file — this is the weapon-evolution/"ultimate" cue the character was designed around from the start
  }

  drawBullets(ctx) {
    for (const b of this.bullets) drawBullet(ctx, b);
  }

  // The beam starts as a small round/oval blob right at the muzzle and stretches out into a
  // long beam as it grows in (see laserShape). Once fully grown it keeps a pulsing brightness
  // and a stream of traveling energy pulses along its length instead of sitting static.
  drawLaser(ctx) {
    if (!this.isLaserTier || !this.alive || this.laserOverheated || this.stunTimer > 0) return;

    const growT = this.laserWidthProgress;
    if (growT <= 0) return;

    const { halfWidth, halfLength } = this.laserShape;
    const muzzle = this.getMuzzlePoint();

    ctx.save();
    ctx.translate(muzzle.x, muzzle.y);
    ctx.rotate(this.aimAngle);

    const pulse = 0.88 + 0.12 * Math.sin(this.laserTime * 16);
    ctx.globalAlpha = pulse;

    // Outer glow — an ellipse anchored at the muzzle (its left edge stays at x=0) that
    // starts circular and stretches into an elongated, rectangle-like beam as halfLength
    // grows much faster than halfWidth.
    const grad = ctx.createLinearGradient(0, 0, halfLength * 2, 0);
    grad.addColorStop(0, "rgba(255,90,60,0.9)");
    grad.addColorStop(1, "rgba(255,70,60,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(halfLength, 0, halfLength, halfWidth, 0, 0, Math.PI * 2);
    ctx.fill();

    // Bright core, same shape, thinner.
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.ellipse(halfLength, 0, halfLength, halfWidth * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    // Traveling energy pulses once the beam is long enough to show them moving.
    if (growT > 0.55) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(halfLength, 0, halfLength, halfWidth, 0, 0, Math.PI * 2);
      ctx.clip();
      const spacing = 90;
      const offset = (this.laserTime * 480) % spacing;
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      for (let x = offset; x < halfLength * 2; x += spacing) {
        ctx.fillRect(x, -halfWidth, 26, halfWidth * 2);
      }
      ctx.restore();
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // A small pulsing glow sitting right on the emitter — cyan-white while actively firing,
  // dim red while cooling down — so the weapon's own state reads at a glance even without
  // checking the HUD text.
  drawLaserMuzzleGlow(ctx) {
    if (!this.isLaserTier || !this.alive || this.stunTimer > 0) return;
    const muzzle = this.getMuzzlePoint();
    const pulse = this.laserOverheated
      ? 0.55 + 0.25 * Math.sin(this.laserTime * 4)
      : 0.75 + 0.25 * Math.sin(this.laserTime * 12);
    const radius = this.laserOverheated ? 9 : 13;
    const color = this.laserOverheated ? `rgba(255,90,60,${0.4 * pulse})` : `rgba(150,225,255,${0.6 * pulse})`;
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(muzzle.x, muzzle.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Round body facing its aim direction, holding whichever weapon it currently has. The
  // weapon is drawn on TOP of the body (not underneath) so the whole gun is always fully
  // visible — drawing it first left its grip half hidden under the opaque body circle.
  drawBody(ctx) {
    const s = this.size;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(-s * 0.13, -s * 0.05, s * 0.06, 0, Math.PI * 2);
    ctx.arc(s * 0.13, -s * 0.05, s * 0.06, 0, Math.PI * 2);
    ctx.fill();

    // Army helmet — the one bit of gear that reads at a glance, since the rest of the outfit
    // is just the held weapon. Sits above the eye line so it never covers them.
    const helmetCy = -s * 0.24;
    const helmetR = s * 0.46;
    ctx.fillStyle = "#33422a";
    ctx.beginPath();
    ctx.arc(0, helmetCy, helmetR, Math.PI, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#2a3521";
    ctx.beginPath();
    ctx.ellipse(0, helmetCy, helmetR * 1.15, s * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#20291a";
    ctx.lineWidth = 1.5;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * helmetR * 0.7, helmetCy + s * 0.04);
      ctx.lineTo(side * s * 0.22, s * 0.16);
      ctx.stroke();
    }

    ctx.fillStyle = "#c8b88a";
    ctx.beginPath();
    ctx.arc(0, helmetCy - s * 0.08, s * 0.035, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    const weaponInfo = GUNNER_WEAPON_IMAGES[this.tier.name];
    if (weaponInfo && weaponInfo.img.complete && weaponInfo.img.naturalWidth > 0) {
      const dw = weaponInfo.displayWidth;
      const dh = dw * (weaponInfo.img.naturalHeight / weaponInfo.img.naturalWidth);
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.aimAngle);
      ctx.drawImage(weaponInfo.img, -GUNNER_WEAPON_GRIP_FRAC_X * dw, -GUNNER_WEAPON_GRIP_FRAC_Y * dh, dw, dh);
      ctx.restore();
    }
  }

  draw(ctx) {
    this.drawBullets(ctx);
    if (!this.alive && this.deathFadeTimer <= 0) return;
    super.draw(ctx);
    this.drawLaserMuzzleGlow(ctx);
    this.drawLaser(ctx);
  }

  // Doubles up as both "weapon evolve progress" and (once on the last tier) "laser heat" — one
  // bar either way, so it fits the same generic slot every other character's ultimate uses.
  get ultimateRatio() {
    if (this.isFinalTier) {
      return this.laserOverheated
        ? Math.max(0, this.laserOverheatTimer / GUNNER_LASER_OVERHEAT_DURATION)
        : Math.max(0, 1 - this.laserFireTimer / GUNNER_LASER_FIRE_DURATION);
    }
    return Math.min(1, this.evolveCharge / this.tier.evolveTime);
  }

  get ultimateBarColor() {
    if (this.isFinalTier) return this.laserOverheated ? "#ff5533" : "#ff9955";
    return "#66ccff";
  }

  drawHud(ctx, x, y, w) {
    let ny = super.drawHud(ctx, x, y, w);
    ctx.textAlign = "left";

    ctx.fillStyle = "#ffffff";
    ctx.font = "14px Arial";
    ctx.fillText(`Weapon: ${this.tier.name}`, x, ny);

    if (this.isFinalTier) {
      ctx.fillStyle = this.laserOverheated ? "#ff8866" : "#ffcc99";
      ctx.font = "11px Arial";
      ctx.fillText(this.laserOverheated ? "Overheating" : "Firing", x, ny + 20);
    }
  }
}
