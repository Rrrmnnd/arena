// Giant: 2.5x the size of a regular character, 300 HP, wanders the arena on its own.
// Weapon: a charge attack — no range limit, it fires 8 seconds after the last attempt
// (and not within the first 3 seconds of a round, so it doesn't just faceplant into a
// wall at spawn): a 0.5s wind-up pinned in place aiming at the opponent's current
// position, then a dash in a perfectly straight line at full speed. On contact it pins
// the opponent directly in front of itself (matching its own position/velocity exactly,
// so the two bodies never overlap) and hauls them along — dealing 10 damage on that first
// touch. If the opponent gets crushed against the arena wall while being hauled, they
// take 15 bonus damage (25 total) and get stunned, and the Giant's charge ends there
// successfully (no self-stun, since it hit its target). If instead the Giant's dash never
// touches the opponent and it rams the wall on its own, THAT whiffed charge is what stuns
// the Giant for 2 seconds. A plain, non-charging bump deals no damage at all. The ultimate
// can't trigger mid-charge — it only fires once any wind-up/dash has fully finished.
//
// Its ultimate "Absorb" isn't manually triggered — it charges up over time, and taking
// damage speeds up the charge too. Once full (and the charge weapon is free), it
// auto-triggers: the Giant grows bigger and stands completely still for 8 seconds (immune
// to knockback); damage taken during this window is cut by 75% before hitting HP. The
// reflected burst it banks isn't tied to that reduced amount, though — it's 50% of the raw
// pre-reduction hit (e.g. take 100 raw -> only lose 25 HP, but bank 50 to reflect), so
// absorbing is a net-positive trade as long as it survives to land the payoff. That burst
// doesn't land on its own — it's tacked onto the Giant's next successful charge hit (charge
// damage + burst combined into one blow).

const GIANT_GROW_SCALE            = 1.3;   // size multiplier while the ultimate is active
const GIANT_CHARGE_TIME           = 40.0;  // seconds needed to fill the ultimate meter
const GIANT_ABSORB_TIME           = 5.0;   // seconds the absorb window lasts (Giant stands still)
const GIANT_DAMAGE_CHARGE_BONUS   = 0.25;  // extra charge-seconds gained per point of damage taken while charging
const GIANT_ABSORB_DAMAGE_REDUCT  = 0.75;  // fraction of incoming damage mitigated while absorbing
const GIANT_ABSORB_REFLECT_RATIO  = 0.5;   // fraction of the RAW incoming damage banked for the later reflect (independent of the reduction above)

const GIANT_CHARGE_ATTACK_DAMAGE    = 10;   // damage dealt by a successful charge hit
const GIANT_WALL_SLAM_BONUS_DAMAGE  = 15;   // extra damage when the hauled opponent gets crushed into the wall
const GIANT_CHARGE_ATTACK_COOLDOWN  = 7.0;  // seconds between charge attempts
const GIANT_ROUND_START_GRACE       = 3.0;  // seconds after a round starts before it can charge at all
const GIANT_CHARGE_WINDUP_TIME      = 0.5;  // seconds paused before the dash actually launches
const GIANT_CHARGE_ATTACK_SPEED     = 800;  // px/sec while dashing — well above normal wandering speed
const GIANT_WALL_STUN_DURATION       = 2.0;  // seconds the Giant itself is stunned after a whiffed charge rams the wall
const GIANT_WALL_SLAM_STUN_DURATION  = 1.0;  // seconds the OPPONENT is stunned after being crushed into the wall
const GIANT_PUSH_GRACE              = 0.2;  // seconds the "being hauled" state survives without a fresh refresh
const GIANT_TRAIL_INTERVAL          = 0.03; // seconds between afterimage samples while charging
const GIANT_TRAIL_FADE_RATE         = 1.6;  // how fast each afterimage fades out

class Giant extends Character {
  constructor(x, y) {
    super({
      x, y,
      size: CHAR_BASE_SIZE * 2.5,
      color: "#8a8a78",
      maxHp: 300,
      name: "Giant",
      speed: 140,
    });

    this.skillState = "charging"; // charging | absorbing
    this.chargeTime = 0;          // seconds charged so far while charging; seconds remaining while absorbing
    this.absorbedDamage = 0;      // banked reflect (50% of raw damage taken) during the current absorb window, not yet settled
    this.pendingBurst = 0;        // settled damage waiting to be delivered on the next contact
    this.lastBurst = 0;
    this.burstFlashTimer = 0;

    this.isWindingUp = false;        // paused, about to launch a charge
    this.windUpTimer = 0;
    this.chargeDirX = 0;
    this.chargeDirY = 0;
    this.isCharging = false;         // mid-dash right now
    this.hasHitOpponentThisCharge = false; // whether this charge has connected yet (no self-stun if so)
    this.chargeAttackCooldown = GIANT_ROUND_START_GRACE; // counts down between charge attempts; starts with the round-start grace

    this.trail = [];                 // afterimage snapshots while dashing: {x, y, size, alpha}
    this.trailTimer = 0;
  }

  // While charging OR winding up, the Giant can't be shoved or deflected by generic
  // collision physics. This matters most during the wind-up: it's standing still with
  // velocity (0,0), and without this, anyone bumping into it there would get their own
  // velocity swapped down to match the Giant's zero — which is exactly the "opponent's
  // speed drops to 0 near a corner" bug (Giant winds up right next to a wall-pinned
  // opponent, generic physics zeroes them out).
  get knockbackImmune() {
    return this.isCharging || this.isWindingUp;
  }

  takeDamage(dmg, colorOverride = null) {
    if (this.skillState === "absorbing") {
      const actual = dmg * (1 - GIANT_ABSORB_DAMAGE_REDUCT); // only a quarter actually hits HP
      this.absorbedDamage += dmg * GIANT_ABSORB_REFLECT_RATIO; // banks half of the RAW hit, not the reduced amount
      super.takeDamage(actual, colorOverride);
      return;
    }
    super.takeDamage(dmg, colorOverride);
    if (this.skillState === "charging") {
      this.chargeTime += dmg * GIANT_DAMAGE_CHARGE_BONUS;
    }
  }

  onVictory() {
    playSfx("giantWin", 0.4, 0);
  }

  // Pauses in place, aiming at the opponent's current position; the actual dash fires
  // once the wind-up timer runs out (see launchCharge). No range limit — it always aims
  // at wherever the opponent currently is.
  startWindUp(opponent) {
    const dx = opponent.x - this.x;
    const dy = opponent.y - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    this.chargeDirX = dx / dist;
    this.chargeDirY = dy / dist;
    this.isWindingUp = true;
    this.windUpTimer = GIANT_CHARGE_WINDUP_TIME;
    this.hasHitOpponentThisCharge = false;
    this.vx = 0;
    this.vy = 0;
    this.chargeAttackCooldown = GIANT_CHARGE_ATTACK_COOLDOWN;
  }

  launchCharge() {
    this.isWindingUp = false;
    this.isCharging = true;
    this.vx = this.chargeDirX * GIANT_CHARGE_ATTACK_SPEED;
    this.vy = this.chargeDirY * GIANT_CHARGE_ATTACK_SPEED;
  }

  // Shared impact FX for either a whiffed wall-ram or a successful wall-slam.
  spawnWallImpactFx(x, y, colors) {
    playSfx("wallSlam", 0.7);
    spawnImpactParticles(x, y, colors, 46, 1.8, 260);
    spawnImpactParticles(x, y, ["#ffffff", "#ffcf6b"], 14, 1.2, 120);
    spawnFlash(x, y, "#ffffff", 90, 0.3);
    spawnWallCrack(x, y);
    triggerShake(14, 0.35);
  }

  // The charge whiffed and rammed the wall on its own: stunned in place for a couple seconds.
  stunFromWallHit() {
    this.isCharging = false;
    this.applyStun(GIANT_WALL_STUN_DURATION);
    this.spawnWallImpactFx(this.x, this.y, ["#cfcfcf", "#a8a8a8", "#e8e8e8"]);
  }

  // The charge already connected — ending here is a success, so no self-stun. Just go
  // back to normal wandering.
  endChargeSuccessfully() {
    this.isCharging = false;
    this.hasHitOpponentThisCharge = false;
    const angle = Math.random() * Math.PI * 2;
    this.vx = Math.cos(angle) * this.speed;
    this.vy = Math.sin(angle) * this.speed;
  }

  // Overridden so a charge that rams a wall WITHOUT ever touching the opponent triggers
  // a stun. If it already connected this charge, onCollide handles ending it instead.
  moveAndBounce(dt) {
    const bounced = super.moveAndBounce(dt);
    if (bounced && this.isCharging && !this.hasHitOpponentThisCharge) this.stunFromWallHit();
    return bounced;
  }

  // Fires every frame the Giant is touching its opponent while charging. Rather than
  // relying on velocity + generic separation (which can let the much-smaller opponent
  // overlap into the Giant), this directly pins the opponent to an exact non-overlapping
  // spot right in front of the Giant every frame. If that spot would fall outside the
  // arena, the opponent is being crushed against the wall: bonus damage + stun for them,
  // and the Giant's charge ends right there, successfully, with no self-stun.
  onCollide(opponent) {
    if (!this.isCharging) return;

    if (!this.hasHitOpponentThisCharge) {
      this.hasHitOpponentThisCharge = true;
      playSfx("giantChargeHit", 0.45);
      spawnImpactParticles(this.x, this.y, ["#ffcf6b", "#ff8c00", "#ffffff"], 20, 1.1, 0);
      spawnFlash(this.x, this.y, "#ff8c00", 55, 0.2);

      let dmg = GIANT_CHARGE_ATTACK_DAMAGE;
      if (this.pendingBurst > 0) {
        dmg += this.pendingBurst;
        this.lastBurst = Math.ceil(this.pendingBurst);
        this.pendingBurst = 0;
        this.burstFlashTimer = 1.2;
        playSfx("giantBurst", 0.6);
      }
      opponent.takeDamage(dmg);

      // The hit itself was lethal — the charge keeps going (it might plow straight into
      // someone else, e.g. in VS BOSS mode), but there's no corpse left to pin/drag or to
      // eventually crush into a wall. Clear the "already hit" flag: a *subsequent* wall hit
      // with nobody left in front to cushion it should still stun the Giant like a whiffed
      // charge would (moveAndBounce()'s check keys off this same flag), and a subsequent hit
      // on another target deals fresh damage instead of silently no-op'ing.
      if (!opponent.alive) {
        this.hasHitOpponentThisCharge = false;
        return;
      }
    }

    const pinDist = this.size / 2 + opponent.size / 2;
    const desiredX = this.x + this.chargeDirX * pinDist;
    const desiredY = this.y + this.chargeDirY * pinDist;

    const oppHalf = opponent.size / 2;
    const minX = ARENA.x + ARENA_BORDER + oppHalf;
    const maxX = ARENA.x + ARENA.w - ARENA_BORDER - oppHalf;
    const minY = ARENA.y + ARENA_BORDER + oppHalf;
    const maxY = ARENA.y + ARENA.h - ARENA_BORDER - oppHalf;

    const clampedX = Math.min(maxX, Math.max(minX, desiredX));
    const clampedY = Math.min(maxY, Math.max(minY, desiredY));
    const crushedAgainstWall = clampedX !== desiredX || clampedY !== desiredY;

    opponent.x = clampedX;
    opponent.y = clampedY;

    if (crushedAgainstWall) {
      opponent.vx = 0;
      opponent.vy = 0;
      opponent.pushedByGiantTimer = 0;
      opponent.takeDamage(GIANT_WALL_SLAM_BONUS_DAMAGE);
      opponent.applyStun(GIANT_WALL_SLAM_STUN_DURATION);
      this.spawnWallImpactFx(clampedX, clampedY, ["#e0a030", "#ffcf6b", "#ffffff"]);

      this.x = clampedX - this.chargeDirX * pinDist;
      this.y = clampedY - this.chargeDirY * pinDist;
      this.endChargeSuccessfully();
    } else {
      opponent.vx = this.chargeDirX * GIANT_CHARGE_ATTACK_SPEED;
      opponent.vy = this.chargeDirY * GIANT_CHARGE_ATTACK_SPEED;
      opponent.pushedByGiantTimer = GIANT_PUSH_GRACE;

      this.vx = this.chargeDirX * GIANT_CHARGE_ATTACK_SPEED;
      this.vy = this.chargeDirY * GIANT_CHARGE_ATTACK_SPEED;
    }
  }

  update(dt, opponent) {
    super.update(dt, opponent);
    if (!this.alive) return;

    // Afterimage trail: sample a snapshot every so often while dashing, and let every
    // snapshot fade out on its own regardless of stun/state, so it never gets stuck.
    if (this.isCharging) {
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) {
        this.trailTimer = GIANT_TRAIL_INTERVAL;
        this.trail.push({ x: this.x, y: this.y, size: this.size, alpha: 0.4 });
      }
    }
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].alpha -= dt * GIANT_TRAIL_FADE_RATE;
      if (this.trail[i].alpha <= 0) this.trail.splice(i, 1);
    }

    // The absorb window is a fixed 5-second active state, not something that should pause
    // just because the Giant got dazed mid-window — otherwise stunning it becomes a free way
    // to stretch out its own ultimate. So this counts down even while stunned, ahead of the
    // stun gate below. (If it's still stunned exactly when the window closes, stay immovable
    // rather than override that — the stun's own onStunEnd will restore movement later.)
    if (this.skillState === "absorbing") {
      this.chargeTime -= dt;
      if (this.chargeTime <= 0) {
        this.size = this.baseSize;
        this.movable = this.stunTimer <= 0;
        this.pendingBurst += this.absorbedDamage; // 50% of the raw damage taken while absorbing
        this.absorbedDamage = 0;
        this.skillState = "charging";
        this.chargeTime = 0;
      }
    }

    if (this.stunTimer > 0) return; // dazed — no charge-meter progress, no charge-attack logic this frame

    const chargeWeaponFree = !this.isWindingUp && !this.isCharging;

    if (this.skillState === "charging") {
      this.chargeTime += dt;
      if (this.chargeTime >= GIANT_CHARGE_TIME && chargeWeaponFree) {
        this.skillState = "absorbing";
        this.chargeTime = GIANT_ABSORB_TIME;
        this.absorbedDamage = 0;
        this.size = this.baseSize * GIANT_GROW_SCALE;
        this.movable = false; // stands still while absorbing, can't be knocked back
        playSfx("absorb", 0.9, 0); // louder + no pitch variance, so it cuts through combat noise
      }
    }

    if (this.burstFlashTimer > 0) {
      this.burstFlashTimer -= dt;
    }

    // Charge-attack weapon: only usable while free to move (not mid-absorb) and not
    // already winding up/dashing. No range limit — fires the moment cooldown allows.
    if (this.chargeAttackCooldown > 0) this.chargeAttackCooldown -= dt;

    if (this.isWindingUp) {
      this.windUpTimer -= dt;
      if (this.windUpTimer <= 0) this.launchCharge();
    } else if (!this.isCharging && this.skillState !== "absorbing" && this.chargeAttackCooldown <= 0 && opponent && opponent.alive) {
      this.startWindUp(opponent);
    }
  }

  // Stone-golem look: beveled edges, crack lines, and eyes that shift color with skill state
  drawBody(ctx) {
    const half = this.size / 2;
    const x0 = this.x - half;
    const y0 = this.y - half;

    ctx.fillStyle = this.color;
    ctx.fillRect(x0, y0, this.size, this.size);

    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(x0, y0, this.size, this.size * 0.1);
    ctx.fillRect(x0, y0, this.size * 0.1, this.size);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(x0, y0 + this.size * 0.9, this.size, this.size * 0.1);
    ctx.fillRect(x0 + this.size * 0.9, y0, this.size * 0.1, this.size);

    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = Math.max(2, this.size * 0.015);
    ctx.beginPath();
    ctx.moveTo(x0 + this.size * 0.22, y0 + this.size * 0.15);
    ctx.lineTo(x0 + this.size * 0.38, y0 + this.size * 0.42);
    ctx.lineTo(x0 + this.size * 0.28, y0 + this.size * 0.68);
    ctx.moveTo(x0 + this.size * 0.68, y0 + this.size * 0.22);
    ctx.lineTo(x0 + this.size * 0.75, y0 + this.size * 0.5);
    ctx.lineTo(x0 + this.size * 0.88, y0 + this.size * 0.78);
    ctx.stroke();

    const eyeColor = this.skillState === "absorbing" ? "#ffd23c"
      : this.stunTimer > 0 ? "#999999"
      : this.isWindingUp ? "#ffffff"
      : this.isCharging ? "#ff8c00"
      : this.pendingBurst > 0 ? "#ff5050"
      : "#bcd6ff";
    const eyeY = y0 + this.size * 0.34;
    const eyeDX = this.size * 0.16;
    const eyeR = Math.max(3, this.size * 0.045);
    ctx.fillStyle = eyeColor;
    ctx.beginPath();
    ctx.arc(this.x - eyeDX, eyeY, eyeR, 0, Math.PI * 2);
    ctx.arc(this.x + eyeDX, eyeY, eyeR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Motion-blur afterimages left behind while dashing, drawn under the current body
  drawTrail(ctx) {
    if (!this.alive) return;
    for (const t of this.trail) {
      ctx.globalAlpha = Math.max(0, t.alpha);
      ctx.fillStyle = this.color;
      ctx.fillRect(t.x - t.size / 2, t.y - t.size / 2, t.size, t.size);
    }
    ctx.globalAlpha = 1;
  }

  // Golden motes spiral inward and vanish into the body — sells "pulling power in" for the
  // 5-second absorb window, in place of the old flat-colored outline box.
  drawAbsorbEffect(ctx) {
    const t = performance.now() / 1000;
    const half = this.size / 2;
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    const glowR = half * (1.15 + 0.08 * pulse);
    const grad = ctx.createRadialGradient(this.x, this.y, half * 0.6, this.x, this.y, glowR);
    grad.addColorStop(0, `rgba(255,210,60,${0.35 * pulse})`);
    grad.addColorStop(1, "rgba(255,210,60,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.x, this.y, glowR, 0, Math.PI * 2);
    ctx.fill();

    const moteCount = 5;
    for (let i = 0; i < moteCount; i++) {
      const cycle = (t * 0.6 + i / moteCount) % 1; // 0 at the rim -> 1 at the center, then loops
      const ang = i * ((Math.PI * 2) / moteCount) + t * 1.4;
      const r = half * 1.4 * (1 - cycle);
      ctx.globalAlpha = 0.85 * (1 - cycle * 0.3);
      ctx.fillStyle = "#ffe9a8";
      ctx.beginPath();
      ctx.arc(this.x + Math.cos(ang) * r, this.y + Math.sin(ang) * r, 3 + 2 * (1 - cycle), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Banked reflect damage waiting to be cashed in on the next successful charge hit — quiet
  // red embers drifting off the shoulders, since this is stored power sitting idle rather
  // than something actively building.
  drawPendingBurstEffect(ctx) {
    const t = performance.now() / 1000;
    const half = this.size / 2;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    const glowR = half * 1.1;
    const grad = ctx.createRadialGradient(this.x, this.y, half * 0.7, this.x, this.y, glowR);
    grad.addColorStop(0, `rgba(255,80,80,${0.18 * pulse})`);
    grad.addColorStop(1, "rgba(255,80,80,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.x, this.y, glowR, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 2; i++) {
      const cycle = (t * 0.4 + i / 2) % 1;
      const ex = this.x + (i === 0 ? -half * 0.5 : half * 0.5);
      const ey = this.y + half * 0.6 - cycle * half * 1.6;
      ctx.globalAlpha = (1 - cycle) * 0.8;
      ctx.fillStyle = "#ff8060";
      ctx.beginPath();
      ctx.arc(ex, ey, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // State is readable from the eye color plus one of the ambient effects above — no flat
  // outline box any more, so nothing can get left showing a stale color after a transition.
  draw(ctx) {
    this.drawTrail(ctx);
    super.draw(ctx);
    if (!this.alive) return;

    if (this.skillState === "absorbing") this.drawAbsorbEffect(ctx);
    else if (this.pendingBurst > 0) this.drawPendingBurstEffect(ctx);
  }

  // While absorbing there's no charge left to show progress on, so the bar just reads as
  // "full/active" in a different color — the bar itself never disappears, only its meaning
  // and color change.
  get ultimateRatio() {
    if (this.skillState === "absorbing") return 1;
    return Math.min(1, this.chargeTime / GIANT_CHARGE_TIME);
  }

  get ultimateBarColor() {
    return this.skillState === "absorbing" ? "#ffd23c" : "#64c8ff";
  }

  // Absorbing is the one Giant state the bars can't show — the ultimate bar reads as charge
  // either way, but what's being banked into the counter-burst is the number that matters.
  drawHud(ctx, x, y, w) {
    const ny = super.drawHud(ctx, x, y, w);
    if (this.skillState === "absorbing") {
      this.drawHudNote(ctx, x, ny, `Absorbing ${Math.ceil(this.absorbedDamage)}`, "#ffd23c");
    }
  }
}
