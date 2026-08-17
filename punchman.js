// Punch Man: round body, twin fists, fast low-damage combat.
// Normally throws 5 punches/sec at 2 dmg each; the ultimate "Rampage Mode" extends his
// reach, bumps damage to 3 per punch, ramps attack speed up to 12.5 punches/sec, and
// makes him move 1.75x faster, for 5 seconds, then reverts and starts charging again.

const PUNCHMAN_FIST_DAMAGE      = 2;
const PUNCHMAN_RAGE_DAMAGE      = 3;     // damage per punch during Rampage Mode
const PUNCHMAN_BASE_RATE        = 5;     // attacks per second, normally
const PUNCHMAN_RAGE_RATE        = 12.5;  // attacks per second, during Rampage Mode
const PUNCHMAN_BASE_RANGE       = 40;    // normal attack range (placeholder, tune later)
const PUNCHMAN_RAGE_BASE_RANGE_BONUS     = 20; // extra reach added to the base range during Rampage Mode
const PUNCHMAN_RAGE_ULTIMATE_RANGE_BONUS = 50; // additional reach on top, specifically from the ultimate
const PUNCHMAN_RAGE_SPEED_MULT  = 1.75;  // movement speed multiplier during Rampage Mode
const PUNCHMAN_RAGE_DURATION    = 5.0;   // seconds Rampage Mode lasts
const PUNCHMAN_CHARGE_TIME      = 25.0;  // seconds needed to fill the ultimate meter
const PUNCHMAN_DAMAGE_CHARGE_BONUS = 0.1;  // extra charge-seconds gained per point of damage dealt while charging
const PUNCHMAN_TAKEN_CHARGE_BONUS  = 0.1;  // extra charge-seconds gained per point of damage taken while charging
const PUNCHMAN_MAX_HP           = 150;   // placeholder HP, not specified yet
const PUNCHMAN_PUNCH_ANIM_TIME  = 0.12;  // punch animation length (seconds)
const PUNCHMAN_ATTACK_SLOW_FACTOR = 0.35; // movement speed multiplier while in attack range, so he sticks to his target
const PUNCHMAN_CELEBRATE_SPIN_SPEED = 6;  // radians/sec spun during his victory dance

class PunchMan extends Character {
  constructor(x, y) {
    super({
      x, y,
      size: CHAR_BASE_SIZE,
      color: "#e0a030",
      maxHp: PUNCHMAN_MAX_HP,
      name: "Punch Man",
      speed: 330,
    });

    this.skillState = "charging"; // charging | rage
    this.chargeTime = 0;          // seconds charged so far while charging; seconds remaining during rage
    this.attackTimer = 0;

    this.facingAngle = Math.random() * Math.PI * 2;
    this.punchAnimTimer = 0;
    this.punchAnimSide = 1; // 1 or -1, alternates fists
    this.inRange = false;   // whether the opponent is within attack range right now
    this.celebrating = false; // true once he's won: keeps moving around while spinning and throwing punches

    this.pushedByGiantTimer = 0; // >0 while being hauled along by the Giant's charge
  }

  onVictory() {
    this.celebrating = true;
  }

  takeDamage(dmg, colorOverride = null) {
    super.takeDamage(dmg, colorOverride);
    if (dmg > 0 && this.alive && this.skillState === "charging") {
      this.chargeTime += dmg * PUNCHMAN_TAKEN_CHARGE_BONUS;
    }
  }

  get attackRate() {
    return this.skillState === "rage" ? PUNCHMAN_RAGE_RATE : PUNCHMAN_BASE_RATE;
  }

  get attackRange() {
    const bonus = this.skillState === "rage"
      ? PUNCHMAN_RAGE_BASE_RANGE_BONUS + PUNCHMAN_RAGE_ULTIMATE_RANGE_BONUS
      : 0;
    return this.size / 2 + PUNCHMAN_BASE_RANGE + bonus;
  }

  // Slows down while in range, so he sticks to the opponent instead of zooming past —
  // except while being hauled by the Giant's charge, which overrides everything. (The
  // Giant's onCollide is what actually pins his position and detects a wall slam; this
  // is just so his own movement doesn't fight that while it's happening.) Rampage Mode
  // layers a 1.75x speed multiplier on top, but never while being hauled.
  moveAndBounce(dt) {
    const beingPushed = this.pushedByGiantTimer > 0;
    let scale = 1;
    if (!beingPushed) {
      scale = this.inRange ? PUNCHMAN_ATTACK_SLOW_FACTOR : 1;
      if (this.skillState === "rage") scale *= PUNCHMAN_RAGE_SPEED_MULT;
    }
    return super.moveAndBounce(dt * scale);
  }

  update(dt, opponent) {
    if (this.deathFadeTimer > 0) this.deathFadeTimer -= dt; // keeps fading even though the rest of update() bails out below
    if (!this.alive) return;

    if (this.celebrating) {
      super.update(dt, opponent); // keeps wandering and bouncing off walls
      this.facingAngle += dt * PUNCHMAN_CELEBRATE_SPIN_SPEED;
      if (this.punchAnimTimer > 0) this.punchAnimTimer -= dt;
      if (this.punchAnimTimer <= 0) {
        this.punchAnimTimer = PUNCHMAN_PUNCH_ANIM_TIME;
        this.punchAnimSide *= -1;
        playSfx("punch", 0.3);
      }
      return;
    }

    if (opponent && opponent.alive) {
      const dx = opponent.x - this.x;
      const dy = opponent.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.01) this.facingAngle = Math.atan2(dy, dx);
      this.inRange = dist <= this.attackRange + opponent.size / 2;
    } else {
      this.inRange = false;
    }

    super.update(dt, opponent);
    if (this.pushedByGiantTimer > 0) this.pushedByGiantTimer -= dt;
    if (this.stunTimer > 0) return; // dazed — can't attack or charge up right now

    if (this.skillState === "charging") {
      this.chargeTime += dt;
      if (this.chargeTime >= PUNCHMAN_CHARGE_TIME) {
        this.skillState = "rage";
        this.chargeTime = PUNCHMAN_RAGE_DURATION;
        playSfx("punchmanUltimate", 0.8);
        spawnImpactParticles(this.x, this.y, ["#ff7028", "#ffd23c", "#ffffff"], 36, 1.4, -40);
        spawnFlash(this.x, this.y, "#ff7028", 90, 0.45);
        triggerShake(6, 0.25);
      }
    } else if (this.skillState === "rage") {
      this.chargeTime -= dt;
      if (this.chargeTime <= 0) {
        this.skillState = "charging";
        this.chargeTime = 0;
      }
    }

    if (this.attackTimer > 0) this.attackTimer -= dt;
    if (this.punchAnimTimer > 0) this.punchAnimTimer -= dt;

    if (opponent && opponent.alive && this.attackTimer <= 0 && this.inRange && this.canAttack) {
      const dmg = this.skillState === "rage" ? PUNCHMAN_RAGE_DAMAGE : PUNCHMAN_FIST_DAMAGE;
      opponent.takeDamage(dmg);
      this.attackTimer += 1 / this.attackRate;
      if (this.skillState === "charging") {
        this.chargeTime += dmg * PUNCHMAN_DAMAGE_CHARGE_BONUS;
      }
      this.punchAnimTimer = PUNCHMAN_PUNCH_ANIM_TIME;
      this.punchAnimSide *= -1;
      playSfx("punch", 0.35);

      const impactX = opponent.x - Math.cos(this.facingAngle) * (opponent.size / 2);
      const impactY = opponent.y - Math.sin(this.facingAngle) * (opponent.size / 2);
      spawnImpactParticles(impactX, impactY, ["#ffcf6b", "#ffe066", "#ff8c30"], 16, 1, 0);
    }
  }

  // Round body plus a pair of fists; one shoots out toward the target when a punch lands
  drawBody(ctx) {
    const r = this.size / 2;

    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 3;
    ctx.stroke();

    const restDist = r + 16;
    const fistR = 12;

    [-1, 1].forEach((side) => {
      let dist = restDist;
      if (this.punchAnimTimer > 0 && side === this.punchAnimSide) {
        const t = this.punchAnimTimer / PUNCHMAN_PUNCH_ANIM_TIME; // 1 → 0
        dist = restDist + Math.sin((1 - t) * Math.PI) * 40;
      }
      const a = this.facingAngle + side * (Math.PI / 4);
      const fx = this.x + Math.cos(a) * dist;
      const fy = this.y + Math.sin(a) * dist;
      ctx.fillStyle = "#c88840";
      ctx.beginPath();
      ctx.arc(fx, fy, fistR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  draw(ctx) {
    if (!this.alive && this.deathFadeTimer <= 0) return;

    // Only shown during Rampage, since that's the one time the reach is worth calling out —
    // the normal attack range doesn't change and doesn't need a ring around it every frame.
    if (this.alive && this.stunTimer <= 0 && this.skillState === "rage") {
      ctx.save();
      ctx.strokeStyle = "rgba(255,112,40,0.45)";
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.attackRange, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    super.draw(ctx);

    if (this.alive && this.skillState === "rage") {
      ctx.strokeStyle = "#ff7028";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size / 2 + 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // While raging there's no charge progress to show, so the bar just reads as full/active.
  get ultimateRatio() {
    if (this.skillState === "rage") return 1;
    return Math.min(1, this.chargeTime / PUNCHMAN_CHARGE_TIME);
  }

  get ultimateBarColor() {
    return "#ff7028";
  }

  // No drawHud override: the HUD is deliberately just name + HP bar + ultimate bar for every
  // character. The ability/cooldown readouts that used to sit under it are gone.
}
