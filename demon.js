// Demon: ranged trident-thrower. Holds a trident that visibly tracks the opponent; on attack
// it winds up with a short thrust animation and hurls that trident, and a fresh one grows back
// into its hand before the next throw. Since it isn't a homing shot, a moving target can walk
// out of its path, so it lands in the wall behind them and fades. Every trident that lands
// sticks in the target; the ultimate detonates every stuck trident at once for a damage burst
// plus lifesteal, and permanently ramps up the Demon's offense a little each time it's used.

const DEMON_MAX_HP          = 100;   // glass cannon: least HP on the roster
const DEMON_MAX_OVERFLOW_HP = 50;    // heals (from landed throws or the ultimate) can push HP past maxHp, up to this much
const DEMON_SPEED           = 280;
const DEMON_ATTACK_COOLDOWN = 1.25;  // seconds between throws (base, before ultimate stacking)
const DEMON_MIN_ATTACK_COOLDOWN = 0.1; // floor so ultimate stacking can't shrink it to zero
const DEMON_ATTACK_DAMAGE   = 5;     // base damage per trident that lands
const DEMON_SELF_DAMAGE_PER_THROW = 2;   // HP the Demon pays for every trident it throws — this alone can never kill it
const DEMON_HIT_HP_RETURN         = 2.5; // HP recovered when a thrown trident actually lands (net +0.5 on a hit, -2 on a miss)
const DEMON_TRIDENT_SPEED   = 1300;  // px/sec while in flight — faster flight = smaller dodge window = higher hit chance
const DEMON_KNOCKBACK_STRENGTH = 70;  // px/sec impulse on a base-size (60) target; scales inversely with the target's size
const DEMON_MISS_FADE_TIME  = 2.0;   // seconds a wall-stuck (missed) trident lingers before vanishing
const DEMON_ULTIMATE_CHARGE_STEPS = 10; // throws needed to fill the ultimate meter, hit or miss — not time-based
const DEMON_ULTIMATE_DETONATE_DAMAGE   = 9;    // base damage per stuck trident when the ultimate fires
const DEMON_ULTIMATE_HEAL_RATIO        = 0.5;  // fraction of ultimate damage healed back per trident
const DEMON_ULTIMATE_SPEED_BOOST_DURATION = 2.0;  // seconds of 2x movement speed right after the ultimate fires
const DEMON_ULTIMATE_COOLDOWN_REDUCTION   = 0.25; // permanent attack-cooldown reduction, stacking per ultimate use
const DEMON_ULTIMATE_DAMAGE_BONUS         = 1;    // permanent bonus to all damage dealt, stacking per ultimate use

const DEMON_THROW_WINDUP     = 0.15; // seconds of thrust animation before the trident actually launches
const DEMON_HELD_REGEN_TIME  = 0.3;  // seconds for a fresh trident to grow back into the hand after a throw
const DEMON_HELD_SCALE       = 0.8;  // display scale of the trident while held (thrown ones use scale 1)
const DEMON_HELD_GRIP_GAP    = 14;   // extra clearance beyond the body radius so the grip sits right at its edge, like a fist

const DEMON_VICTORY_ZOOM_DURATION = 2.2;  // seconds to fly from its arena position to fully covering the screen
const DEMON_VICTORY_FLAP_SPEED    = 10;   // radians/sec of wing-flap oscillation while flying at the screen
const DEMON_VICTORY_FLAP_AMOUNT   = 0.35; // how much the wing height oscillates per flap, as a fraction

// Wings/horns/trident are pre-drawn transparent PNGs (see web/assets); only the round body
// is drawn live, same as the other characters.
const demonWingsImg = new Image();
demonWingsImg.src = "assets/demon_wings.png";
const demonHornsImg = new Image();
demonHornsImg.src = "assets/demon_horns.png";
const demonTridentImg = new Image();
demonTridentImg.src = "assets/demon_trident.png";
const DEMON_TRIDENT_TIP_FRACTION  = 208 / 220; // where the fork sits along the source image's width — anchor for thrown/stuck tridents
const DEMON_TRIDENT_GRIP_FRACTION = 32 / 220;  // where the grip/pommel sits — anchor while held, so it reads as gripped in-place rather than floating

// A trident's a simple state machine: flies straight until it either sticks into the
// opponent (embedded) or reaches a wall (stuck), then eventually disappears.
class Trident {
  constructor(x, y, angle) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.vx = Math.cos(angle) * DEMON_TRIDENT_SPEED;
    this.vy = Math.sin(angle) * DEMON_TRIDENT_SPEED;
    this.state = "flying"; // flying | embedded | stuck
    this.target = null;
    this.offsetAngle = 0; // where around the target's perimeter this one is stuck, once embedded
    this.fadeTimer = 0;
    this.life = 3.0; // safety timeout, in case it somehow never reaches a wall
  }
}

function drawTridentShape(ctx, x, y, angle, scale = 1, alpha = 1, anchorFraction = DEMON_TRIDENT_TIP_FRACTION) {
  if (!demonTridentImg.complete || demonTridentImg.naturalWidth === 0) return;

  const w = 95 * scale;
  const h = w * (demonTridentImg.naturalHeight / demonTridentImg.naturalWidth);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(angle);
  // anchorFraction picks which point along the shaft lands at (x,y): the fork tip for thrown/stuck
  // tridents (so x,y is where the prongs are), or the grip near the base while held (so it reads
  // as gripped in place rather than floating a spear's-length away).
  ctx.drawImage(demonTridentImg, -w * anchorFraction, -h / 2, w, h);
  ctx.restore();
}

class Demon extends Character {
  constructor(x, y) {
    super({
      x, y,
      size: CHAR_BASE_SIZE,
      color: "#8a1030",
      maxHp: DEMON_MAX_HP,
      name: "Demon",
      speed: DEMON_SPEED,
    });

    this.attackTimer = 0;
    this.chargeSteps = 0; // 0..DEMON_ULTIMATE_CHARGE_STEPS, +1 per throw regardless of hit/miss
    this.tridents = []; // every trident thrown this round: flying, embedded, or stuck-in-wall

    this.aimAngle = 0;          // direction the held trident (and the next throw) faces
    this.throwWindup = 0;       // >0 during the brief thrust animation before a throw launches
    this.heldTridentScale = 1;  // 0..1 pop-in scale for the trident regrowing in hand after a throw

    this.speedBoostTimer = 0;      // >0 for a burst of movement speed right after using the ultimate
    this.attackCooldownBonus = 0;  // permanent cooldown reduction banked from past ultimate uses
    this.bonusDamage = 0;          // permanent damage bonus banked from past ultimate uses

    this.celebratingVictory = false; // true once it's won: flies at the screen until it fills it, laughing
    this.victoryTimer = 0;
    this.victoryStartX = 0;
    this.victoryStartY = 0;
    this.wingFlapPhase = 0;
    this.lastFlapCycle = 0;
  }

  onVictory() {
    this.celebratingVictory = true;
    this.victoryTimer = 0;
    this.victoryStartX = this.x;
    this.victoryStartY = this.y;
    this.wingFlapPhase = 0;
    this.lastFlapCycle = 0;
    this.movable = false;
    this.vx = 0;
    this.vy = 0;
    playSfx("demonLaugh", 0.9); // laughs the instant it's won, not once it's finished filling the screen
  }

  get victoryProgress() {
    return Math.min(1, this.victoryTimer / DEMON_VICTORY_ZOOM_DURATION);
  }

  get embeddedTridents() {
    return this.tridents.filter((t) => t.state === "embedded");
  }

  get effectiveAttackCooldown() {
    return Math.max(DEMON_MIN_ATTACK_COOLDOWN, DEMON_ATTACK_COOLDOWN - this.attackCooldownBonus);
  }

  get effectiveAttackDamage() {
    return DEMON_ATTACK_DAMAGE + this.bonusDamage;
  }

  // Shared math for both the floating field bar and the HUD panel bar: the bar's full width
  // represents maxHp + the overflow cap. The 0..maxHp portion keeps the normal green/yellow/
  // red health-percentage coloring; only the banked-overflow portion past that line is drawn
  // in a separate, distinct red — not the whole bar going gold.
  get hpBarInfo() {
    const cap = this.maxHp + DEMON_MAX_OVERFLOW_HP;
    const normalMarkRatio = this.maxHp / cap; // where the maxHp line sits along the full bar width
    const hpRatio = this.hp / this.maxHp; // can exceed 1 while overflowing
    const baseFillRatio = Math.max(0, Math.min(1, hpRatio));
    const overflow = Math.max(0, this.hp - this.maxHp);
    const overflowFillRatio = Math.max(0, Math.min(1, overflow / DEMON_MAX_OVERFLOW_HP));
    const overflowing = overflow > 0;
    const baseColor = hpRatio > 0.5 ? "#50f050" : hpRatio > 0.3 ? "#ffc832" : "#ff3c3c";
    return { normalMarkRatio, baseFillRatio, overflowFillRatio, overflowing, baseColor };
  }

  // Draws the two-segment bar (normal HP + banked overflow) into an arbitrary box — shared by
  // both the floating field bar and the HUD panel bar, which only differ in position/size.
  drawSegmentedHpBar(ctx, barX, barY, barW, barH) {
    const { normalMarkRatio, baseFillRatio, overflowFillRatio, baseColor } = this.hpBarInfo;
    const baseSegW = barW * normalMarkRatio;
    const overflowSegW = barW - baseSegW;

    ctx.fillStyle = "#1e1e23";
    ctx.fillRect(barX, barY, barW, barH);

    ctx.fillStyle = baseColor;
    ctx.fillRect(barX, barY, baseSegW * baseFillRatio, barH);

    if (overflowFillRatio > 0) {
      ctx.fillStyle = "#ff2020"; // vivid red for banked overflow HP, distinct from the low-HP warning red
      ctx.fillRect(barX + baseSegW, barY, overflowSegW * overflowFillRatio, barH);
    }

    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    const markX = barX + baseSegW;
    ctx.beginPath();
    ctx.moveTo(markX, barY);
    ctx.lineTo(markX, barY + barH);
    ctx.stroke();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.strokeRect(barX, barY, barW, barH);
  }

  get ultimateRatio() {
    return this.chargeSteps / DEMON_ULTIMATE_CHARGE_STEPS;
  }

  get ultimateBarColor() {
    return "#ff3050";
  }

  // Overrides the base floating field bar so it can show banked overflow HP too — see
  // drawSegmentedHpBar/hpBarInfo.
  drawFieldHpBar(ctx) {
    const barW = Math.max(70, this.size * 0.9);
    const barX = this.x - barW / 2;
    const barY = this.y - this.size / 2 - 22;
    this.drawSegmentedHpBar(ctx, barX, barY, barW, 10);

    ctx.fillStyle = this.hpBarInfo.overflowing ? "#ff2020" : "#ffffff";
    ctx.font = "12px Arial";
    ctx.textAlign = "center";
    ctx.fillText(`${Math.ceil(this.hp)}/${this.maxHp}`, this.x, barY - 4);

    this.drawBar(ctx, barX, barY + 10 + 4, barW, 6, this.ultimateRatio, this.ultimateBarColor, 1);
  }

  // Landed throws and the ultimate's lifesteal can push HP past maxHp now, up to
  // DEMON_MAX_OVERFLOW_HP banked on top — the base Character.heal() clamps to maxHp exactly,
  // so this overrides that cap instead of raising it globally for every character.
  heal(amount) {
    if (amount <= 0 || !this.alive) return;
    const cap = this.maxHp + DEMON_MAX_OVERFLOW_HP;
    const before = this.hp;
    this.hp = Math.min(cap, this.hp + amount);
    const healed = this.hp - before;
    if (healed > 0) spawnDamageNumber(this.x, this.y, healed, false, true);
  }

  onDeath() {
    super.onDeath();
    this.tridents = this.tridents.filter((t) => t.state !== "embedded"); // can't detonate anymore
  }

  // Ultimate payoff includes a temporary 2x speed burst — scale dt while it's active rather
  // than touching this.speed/vx/vy permanently, same trick Punch Man's rage mode uses.
  moveAndBounce(dt) {
    const mult = this.speedBoostTimer > 0 ? 2 : 1;
    return super.moveAndBounce(dt * mult);
  }

  update(dt, opponent) {
    super.update(dt, opponent);
    if (!this.alive) { this.updateTridents(dt, opponent); return; }

    if (this.celebratingVictory) {
      this.updateVictoryZoom(dt);
      this.updateTridents(dt, opponent); // lets any leftover tridents keep fading out normally
      return;
    }

    if (this.speedBoostTimer > 0) this.speedBoostTimer -= dt;
    if (this.heldTridentScale < 1) this.heldTridentScale = Math.min(1, this.heldTridentScale + dt / DEMON_HELD_REGEN_TIME);

    if (this.stunTimer > 0) { this.updateTridents(dt, opponent); return; }

    // Aim tracks the opponent live except mid-windup, where the throw direction is locked in.
    if (opponent && opponent.alive && this.throwWindup <= 0) {
      this.aimAngle = Math.atan2(opponent.y - this.y, opponent.x - this.x);
    }

    if (this.attackTimer > 0) this.attackTimer -= dt;

    if (this.throwWindup > 0) {
      this.throwWindup -= dt;
      if (this.throwWindup <= 0) this.launchTrident(opponent);
    } else if (opponent && opponent.alive && this.attackTimer <= 0 && this.heldTridentScale >= 1 && this.canAttack) {
      this.throwWindup = DEMON_THROW_WINDUP;
      this.attackTimer += this.effectiveAttackCooldown;
      playSfx("demonThrow", 0.45);
    }

    // In-flight tridents get a chance to land (and embed) before the ultimate check below,
    // so a throw that fills the meter can still count toward its own detonation if it hits.
    this.updateTridents(dt, opponent);

    // Ultimate: an entirely separate step from throwing — fires the instant the meter is full.
    if (this.chargeSteps >= DEMON_ULTIMATE_CHARGE_STEPS) this.detonate(opponent);
  }

  updateVictoryZoom(dt) {
    this.victoryTimer += dt;
    this.wingFlapPhase += dt * DEMON_VICTORY_FLAP_SPEED;

    const flapCycle = Math.floor(this.wingFlapPhase / (Math.PI * 2));
    if (flapCycle > this.lastFlapCycle) {
      this.lastFlapCycle = flapCycle;
      playSfx("demonWings", 0.6);
    }
  }

  launchTrident(opponent) {
    // Spawn the projectile exactly where the held trident's fork currently is (grip anchor +
    // the fork-to-grip span at the held scale), so it visibly leaves the hand instead of
    // popping into existence further out.
    const gripDist = this.size / 2 + DEMON_HELD_GRIP_GAP;
    const heldWidth = 95 * DEMON_HELD_SCALE;
    const tipDist = gripDist + (DEMON_TRIDENT_TIP_FRACTION - DEMON_TRIDENT_GRIP_FRACTION) * heldWidth;
    const x = this.x + Math.cos(this.aimAngle) * tipDist;
    const y = this.y + Math.sin(this.aimAngle) * tipDist;
    this.tridents.push(new Trident(x, y, this.aimAngle));
    this.heldTridentScale = 0; // starts regrowing next frame
    this.chargeSteps = Math.min(DEMON_ULTIMATE_CHARGE_STEPS, this.chargeSteps + 1);

    // Every throw costs a little HP, but never enough to kill on its own — clamped to leave 1 HP.
    const selfDmg = Math.min(DEMON_SELF_DAMAGE_PER_THROW, this.hp - 1);
    if (selfDmg > 0) this.takeDamage(selfDmg);
  }

  updateTridents(dt, opponent) {
    for (let i = this.tridents.length - 1; i >= 0; i--) {
      const t = this.tridents[i];

      if (t.state === "flying") {
        t.life -= dt;
        t.x += t.vx * dt;
        t.y += t.vy * dt;

        if (opponent && opponent.alive) {
          const dist = Math.hypot(opponent.x - t.x, opponent.y - t.y);
          if (dist <= opponent.size / 2 + 6) {
            opponent.takeDamage(this.effectiveAttackDamage);
            this.heal(DEMON_HIT_HP_RETURN); // a landed throw pays back more than it cost

            // A slight shove in the direction it was traveling — bigger targets barely budge,
            // smaller ones get bumped a bit more.
            const kb = DEMON_KNOCKBACK_STRENGTH * (CHAR_BASE_SIZE / opponent.size);
            opponent.applyKnockback(Math.cos(t.angle), Math.sin(t.angle), kb);

            t.state = "embedded";
            t.target = opponent;
            t.offsetAngle = Math.random() * Math.PI * 2;
            playSfx("demonHit", 0.5);
            continue;
          }
        }

        const half = 4;
        const left = ARENA.x + ARENA_BORDER + half;
        const right = ARENA.x + ARENA.w - ARENA_BORDER - half;
        const top = ARENA.y + ARENA_BORDER + half;
        const bottom = ARENA.y + ARENA.h - ARENA_BORDER - half;
        if (t.x < left || t.x > right || t.y < top || t.y > bottom || t.life <= 0) {
          t.x = Math.min(right, Math.max(left, t.x));
          t.y = Math.min(bottom, Math.max(top, t.y));
          t.state = "stuck";
          t.fadeTimer = DEMON_MISS_FADE_TIME;
        }
      } else if (t.state === "stuck") {
        t.fadeTimer -= dt;
        if (t.fadeTimer <= 0) this.tridents.splice(i, 1);
      }
      // embedded tridents live until detonate() clears them (or the round resets)
    }
  }

  detonate(opponent) {
    const stuck = this.embeddedTridents;
    if (opponent && opponent.alive && stuck.length > 0) {
      const dmgPerTrident = DEMON_ULTIMATE_DETONATE_DAMAGE + this.bonusDamage;
      for (const t of stuck) {
        opponent.takeDamage(dmgPerTrident);
        this.heal(dmgPerTrident * DEMON_ULTIMATE_HEAL_RATIO);
      }
      // One huge blood burst as every trident rips back out at once, scaled by how many landed.
      spawnImpactParticles(opponent.x, opponent.y, ["#c40000", "#8a0000", "#ff2020", "#500000"], 26 + stuck.length * 10, 2.4, 170);
      spawnFlash(opponent.x, opponent.y, "#ff2020", 100 + stuck.length * 6, 0.5);
      triggerShake(6 + stuck.length * 0.4, 0.3);
      playSfx("demonUltimate", 0.8);
    }
    this.tridents = this.tridents.filter((t) => t.state !== "embedded");
    this.chargeSteps = 0;

    // Payoff for using the ultimate: a brief speed burst, plus a permanent stacking buff.
    this.speedBoostTimer = DEMON_ULTIMATE_SPEED_BOOST_DURATION;
    this.attackCooldownBonus = Math.min(
      DEMON_ATTACK_COOLDOWN - DEMON_MIN_ATTACK_COOLDOWN,
      this.attackCooldownBonus + DEMON_ULTIMATE_COOLDOWN_REDUCTION
    );
    this.bonusDamage += DEMON_ULTIMATE_DAMAGE_BONUS;
  }

  drawTridents(ctx) {
    for (const t of this.tridents) {
      if (t.state === "flying") {
        drawTridentShape(ctx, t.x, t.y, t.angle, 1, 1);
      } else if (t.state === "embedded" && t.target && t.target.alive) {
        // Sits right at the target's edge, tip pointed inward, like it's stuck into the
        // surface — not buried at some random point inside the body.
        const embedRadius = t.target.size / 2 * 0.82;
        const ex = t.target.x + Math.cos(t.offsetAngle) * embedRadius;
        const ey = t.target.y + Math.sin(t.offsetAngle) * embedRadius;
        const stuckAngle = t.offsetAngle + Math.PI;
        drawTridentShape(ctx, ex, ey, stuckAngle, 0.75, 1);
      } else if (t.state === "stuck") {
        const alpha = Math.max(0, t.fadeTimer / DEMON_MISS_FADE_TIME);
        drawTridentShape(ctx, t.x, t.y, t.angle, 1, alpha);
      }
    }
  }

  // The trident resting/thrusting in the Demon's hand between throws — gripped right at the
  // body's edge (same idea as Punch Man's fists sitting just outside his body), not floating
  // out at arm's length, so a throw reads as "a weapon leaves the hand" rather than "a
  // projectile appears from nowhere". No arm is drawn — the trident alone sells it.
  drawHeldTrident(ctx) {
    if (!this.alive || this.heldTridentScale <= 0.01) return;

    const windProgress = this.throwWindup > 0 ? 1 - this.throwWindup / DEMON_THROW_WINDUP : 0;
    const dist = this.size / 2 + DEMON_HELD_GRIP_GAP + windProgress * 10; // thrusts forward slightly right before release
    const x = this.x + Math.cos(this.aimAngle) * dist;
    const y = this.y + Math.sin(this.aimAngle) * dist;

    drawTridentShape(ctx, x, y, this.aimAngle, DEMON_HELD_SCALE * this.heldTridentScale, 1, DEMON_TRIDENT_GRIP_FRACTION);
  }

  // Round body (wings/horns are pre-drawn PNGs; the eyes are the only other live-drawn bit).
  // Accepts overrides so the fullscreen victory zoom can reuse this exact same look at a
  // huge scale and a flapping wing, instead of drifting out of sync with a duplicate copy.
  drawBody(ctx, overrideX = this.x, overrideY = this.y, overrideSize = this.size, wingFlapScale = 1) {
    const s = overrideSize;
    ctx.save();
    ctx.translate(overrideX, overrideY);

    if (demonWingsImg.complete && demonWingsImg.naturalWidth > 0) {
      const w = s * 2.6;
      const h = w * (demonWingsImg.naturalHeight / demonWingsImg.naturalWidth) * wingFlapScale;
      ctx.drawImage(demonWingsImg, -w / 2, -h / 2, w, h);
    }

    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    if (demonHornsImg.complete && demonHornsImg.naturalWidth > 0) {
      const w = s * 0.95;
      const h = w * (demonHornsImg.naturalHeight / demonHornsImg.naturalWidth);
      ctx.drawImage(demonHornsImg, -w / 2, -s * 0.42 - h / 2, w, h);
    }

    ctx.fillStyle = "#ffe066";
    ctx.beginPath();
    ctx.arc(-s * 0.14, -s * 0.02, s * 0.07, 0, Math.PI * 2);
    ctx.arc(s * 0.14, -s * 0.02, s * 0.07, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  draw(ctx) {
    if (this.celebratingVictory) return; // rendered separately, as a fullscreen overlay on top of the HUD
    if (!this.alive && this.deathFadeTimer <= 0) return;
    super.draw(ctx);
    this.drawHeldTrident(ctx);
    this.drawTridents(ctx);
  }

  // Flies at the viewer until its body covers the whole screen, flapping its wings the whole
  // way — drawn by main.js after the HUD/title so it genuinely ends up on top of everything.
  drawVictoryOverlay(ctx) {
    const t = this.victoryProgress;
    const eased = t * t; // starts slow, then rushes the screen — reads as closing distance fast

    const targetDiameter = Math.max(WIDTH, HEIGHT) * 1.7; // guarantees full coverage regardless of aspect
    const size = this.baseSize + (targetDiameter - this.baseSize) * eased;
    const x = this.victoryStartX + (WIDTH / 2 - this.victoryStartX) * eased;
    const y = this.victoryStartY + (HEIGHT / 2 - this.victoryStartY) * eased;
    const wingFlapScale = 1 + Math.sin(this.wingFlapPhase) * DEMON_VICTORY_FLAP_AMOUNT;

    this.drawBody(ctx, x, y, size, wingFlapScale);
  }

  // Overrides the base name+HP-bar panel (rather than calling super.drawHud()) so the bar can
  // show banked overflow HP past the normal cap — see hpBarInfo.
  // Doesn't call super.drawHud() — the segmented overflow HP bar needs its own drawing code —
  // but still follows the same fixed order the base does: name, HP bar, ultimate bar, and
  // nothing after that.
  drawHud(ctx, x, y, w) {
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px Arial";
    ctx.fillText(this.alive ? this.name : `${this.name} (Defeated)`, x, y);

    const barH = 18;
    const barY = y + 14;
    this.drawSegmentedHpBar(ctx, x, barY, w, barH);

    ctx.fillStyle = this.hpBarInfo.overflowing ? "#ff2020" : "rgba(255,255,255,0.85)";
    ctx.font = "13px Arial";
    ctx.textAlign = "right";
    ctx.fillText(`${Math.ceil(this.hp)}/${this.maxHp}`, x + w, barY - 4);
    ctx.textAlign = "left";

    const ny = barY + barH + 14;

    const ultBarH = 10;
    const ultBarY = ny - 10;
    this.drawBar(ctx, x, ultBarY, w, ultBarH, this.ultimateRatio, this.ultimateBarColor, 1);
    return ultBarY + ultBarH + 16;
  }
}
