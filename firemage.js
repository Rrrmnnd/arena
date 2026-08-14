// Fire Mage: the first of a planned trio of elemental casters (Fire/Ice/Earth), each its own
// separate character rather than one character with a switchable element. Fire Mage's identity
// is ground control, not direct burst — its only attack right now is a lobbed fireball that
// leaves a patch of lava wherever it actually ends up (on the opponent's own position if it hit
// them, or wherever it struck a wall otherwise), which then burns anyone standing in it for a
// long while. No ultimate yet — that's still being designed; VIRUS_-style ultimateRatio simply
// isn't overridden, so no ultimate bar shows in its HUD until there is one.
//
// Deliberately excluded from the Twitch integration's random-battle roster for now (see
// ROSTER_TWITCH in main.js) — it's still new/untested and the request was explicit about that.

const FIREMAGE_MAX_HP = 65;   // glass cannon — no melee of its own at all right now, purely zone control
const FIREMAGE_SPEED   = 240;
const FIREMAGE_SIZE    = CHAR_BASE_SIZE * 0.85; // a bit smaller than Punch Man — a slight, robed figure

const FIREMAGE_FIREBALL_DAMAGE   = 8;
const FIREMAGE_FIREBALL_COOLDOWN = 1.6;
const FIREMAGE_FIREBALL_SPEED    = 480;
const FIREMAGE_FIREBALL_LIFE     = 2.5; // safety timeout in case it somehow never reaches a wall

// The actual point of the character: wherever a fireball ends up — the opponent's own current
// position if it hit them, or the wall it struck otherwise — a patch of ground catches fire and
// keeps burning long after the fireball itself is gone. Anyone standing in it (Fire Mage
// included — this isn't a one-sided hazard) takes a tick every second for as long as it lasts.
const FIREMAGE_LAVA_DURATION      = 15.0;
const FIREMAGE_LAVA_TICK_DAMAGE   = 5;
const FIREMAGE_LAVA_TICK_INTERVAL = 1.0;
const FIREMAGE_LAVA_RADIUS        = 50; // roughly a full body-width bigger than a character, so standing near the middle reliably counts
const FIREMAGE_LAVA_GROW_TIME     = 0.35; // seconds to grow in from nothing when it first lands
const FIREMAGE_LAVA_FADE_TIME     = 1.5;  // seconds of fading out right before it actually expires
const FIREMAGE_LAVA_DAMAGE_COLOR  = "#ff7a1a"; // floating damage-number tint for a lava tick, same idea as Virus's purple Infection numbers

// A single lobbed fireball, aimed at the opponent's position the instant it's released (no
// homing after that) — same "might just miss" logic as every other ranged poke in this roster.
class Fireball {
  constructor(x, y, angle, speed) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.angle = angle;
    this.life = FIREMAGE_FIREBALL_LIFE;
    this.seed = Math.random() * Math.PI * 2; // per-instance flicker phase so a volley doesn't pulse in lockstep
  }
}

// A patch of burning ground. Pure data + a lifetime — see FireMage.updateLavaPatches for the
// actual damage tick, and drawGroundEffects for how it's rendered (grown/faded, not a hard pop
// in and out).
class LavaPatch {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.timer = FIREMAGE_LAVA_DURATION;
    this.tickTimer = FIREMAGE_LAVA_TICK_INTERVAL;
    this.seed = Math.random() * Math.PI * 2;
  }
}

class FireMage extends Character {
  constructor(x, y) {
    super({
      x, y,
      size: FIREMAGE_SIZE,
      color: "#ff5a1f",
      maxHp: FIREMAGE_MAX_HP,
      name: "Fire Mage",
      speed: FIREMAGE_SPEED,
    });

    this.facingAngle = Math.random() * Math.PI * 2;
    this.fireballTimer = 0;
    this.fireballs = [];
    this.lavaPatches = [];

    // Fixed per-instance layout so the robe/flame silhouette doesn't visibly jitter every frame.
    this.bodySeed = Math.random() * Math.PI * 2;
    this.flameWisps = Array.from({ length: 5 }, () => ({
      angle: Math.random() * Math.PI * 2,
      dist: 0.55 + Math.random() * 0.25,
      seed: Math.random() * Math.PI * 2,
    }));
  }

  throwFireball(opponent) {
    const angle = Math.atan2(opponent.y - this.y, opponent.x - this.x);
    const spawnDist = this.size / 2 + 8;
    this.fireballs.push(new Fireball(
      this.x + Math.cos(angle) * spawnDist, this.y + Math.sin(angle) * spawnDist,
      angle, FIREMAGE_FIREBALL_SPEED
    ));
  }

  spawnLava(x, y) {
    this.lavaPatches.push(new LavaPatch(x, y));
    spawnImpactParticles(x, y, ["#ff6a20", "#ffcf40", "#8a2a00"], 20, 1.2, 0);
    triggerShake(6, 0.15);
  }

  // A fireball always leaves lava wherever it actually ends up — on the opponent's own current
  // position if it hit them (not the exact pixel of impact — under their feet, i.e. wherever
  // they are right now), or wherever it struck a wall otherwise. The life-timeout branch is
  // purely a safety net (a straight line in a bounded arena always reaches a wall well before
  // FIREMAGE_FIREBALL_LIFE runs out) but still leaves lava too, for consistency.
  updateFireballs(dt, opponent) {
    for (let i = this.fireballs.length - 1; i >= 0; i--) {
      const f = this.fireballs[i];
      f.life -= dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;

      let landX = f.x, landY = f.y;
      let gone = false;

      if (opponent && opponent.alive) {
        const dist = Math.hypot(opponent.x - f.x, opponent.y - f.y);
        if (dist <= opponent.size / 2 + 8) {
          opponent.takeDamage(FIREMAGE_FIREBALL_DAMAGE);
          landX = opponent.x;
          landY = opponent.y;
          gone = true;
        }
      }

      if (!gone) {
        const outOfBounds = f.x < ARENA.x || f.x > ARENA.x + ARENA.w || f.y < ARENA.y || f.y > ARENA.y + ARENA.h;
        if (outOfBounds) {
          landX = Math.min(ARENA.x + ARENA.w, Math.max(ARENA.x, f.x));
          landY = Math.min(ARENA.y + ARENA.h, Math.max(ARENA.y, f.y));
          gone = true;
        } else if (f.life <= 0) {
          gone = true;
        }
      }

      if (gone) {
        this.spawnLava(landX, landY);
        spawnImpactParticles(f.x, f.y, ["#ffcf40", "#ff6a20"], 10, 0.9, 0);
        this.fireballs.splice(i, 1);
      }
    }
  }

  // Runs independent of Fire Mage's own alive/stun state — same reasoning as Virus's Infection:
  // the fire is already burning on the ground and doesn't need any further action to keep going.
  // Checks BOTH fighters, not just the opponent — standing in your own lava burns just as much.
  updateLavaPatches(dt, opponent) {
    for (let i = this.lavaPatches.length - 1; i >= 0; i--) {
      const lp = this.lavaPatches[i];
      lp.timer -= dt;
      if (lp.timer <= 0) { this.lavaPatches.splice(i, 1); continue; }

      lp.tickTimer -= dt;
      if (lp.tickTimer <= 0) {
        lp.tickTimer += FIREMAGE_LAVA_TICK_INTERVAL;
        for (const c of [this, opponent]) {
          if (!c || !c.alive) continue;
          const dist = Math.hypot(c.x - lp.x, c.y - lp.y);
          if (dist <= FIREMAGE_LAVA_RADIUS + c.size / 2) {
            c.takeDamage(FIREMAGE_LAVA_TICK_DAMAGE, FIREMAGE_LAVA_DAMAGE_COLOR);
            spawnImpactParticles(c.x, c.y - c.size * 0.2, ["#ff7a1a", "#ffcf40"], 6, 0.6, 0);
          }
        }
      }
    }
  }

  update(dt, opponent) {
    this.updateLavaPatches(dt, opponent);

    if (this.deathFadeTimer > 0) this.deathFadeTimer -= dt;
    if (!this.alive) {
      this.updateFireballs(dt, opponent);
      return;
    }

    if (opponent && opponent.alive) {
      const dx = opponent.x - this.x, dy = opponent.y - this.y;
      if (Math.hypot(dx, dy) > 0.01) this.facingAngle = Math.atan2(dy, dx);
    }

    super.update(dt, opponent);
    this.updateFireballs(dt, opponent);

    if (this.stunTimer > 0) return;

    if (this.fireballTimer > 0) this.fireballTimer -= dt;
    if (opponent && opponent.alive && this.fireballTimer <= 0 && this.canAttack) {
      this.fireballTimer += FIREMAGE_FIREBALL_COOLDOWN;
      this.throwFireball(opponent);
    }
  }

  // Ground-level burning patches — drawn under BOTH fighters (see Character.drawGroundEffects
  // and main.js's drawFrame), so whoever's standing in one visibly stands on top of it. Grows in
  // from nothing when it lands, holds, then fades out over its last stretch rather than just
  // popping out of existence.
  drawGroundEffects(ctx) {
    if (!this.lavaPatches.length) return;
    const t = performance.now() / 1000;
    for (const lp of this.lavaPatches) {
      const growT = Math.min(1, (FIREMAGE_LAVA_DURATION - lp.timer) / FIREMAGE_LAVA_GROW_TIME);
      const fadeT = lp.timer < FIREMAGE_LAVA_FADE_TIME ? Math.max(0, lp.timer / FIREMAGE_LAVA_FADE_TIME) : 1;
      const alpha = Math.min(growT, fadeT);
      if (alpha <= 0) continue;
      const scale = 0.6 + 0.4 * growT;
      const r = FIREMAGE_LAVA_RADIUS * scale;

      ctx.save();
      ctx.translate(lp.x, lp.y);
      ctx.globalAlpha = alpha;

      // Irregular molten pool, not a clean circle — wobbles slowly so it reads as a viscous
      // surface rather than a static decal.
      ctx.beginPath();
      const pts = 14;
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2;
        const wob = 1 + Math.sin(a * 3 + lp.seed) * 0.1 + Math.sin(t * 1.3 + a * 5 + lp.seed) * 0.05;
        const px = Math.cos(a) * r * wob, py = Math.sin(a) * r * wob;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      const grad = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
      grad.addColorStop(0, "#ffcf40");
      grad.addColorStop(0.45, "#e8480a");
      grad.addColorStop(1, "#5c1400");
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = "rgba(30,6,0,0.6)";
      ctx.lineWidth = 3;
      ctx.stroke();

      // A few pulsing bright cracks/bubbles across the surface.
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 4; i++) {
        const a = lp.seed + i * 1.7;
        const pulse = 0.4 + Math.sin(t * 2.6 + i * 2) * 0.3;
        const px = Math.cos(a) * r * 0.45, py = Math.sin(a) * r * 0.45;
        ctx.globalAlpha = alpha * Math.max(0, pulse);
        ctx.fillStyle = "#ffe08c";
        ctx.beginPath();
        ctx.arc(px, py, r * 0.14, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawFireballsInFlight(ctx) {
    const t = performance.now() / 1000;
    for (const f of this.fireballs) {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.angle);

      const flicker = 1 + Math.sin(t * 20 + f.seed) * 0.08;
      const headR = 7 * flicker;
      const tailLen = 20;

      ctx.beginPath();
      ctx.moveTo(headR, 0);
      const wob1 = Math.sin(t * 16 + f.seed) * 2;
      const wob2 = Math.sin(t * 16 + f.seed + 2.4) * 2;
      ctx.quadraticCurveTo(0, -headR + wob1, -tailLen * 0.6, -1.5 + wob1 * 0.5);
      ctx.quadraticCurveTo(-tailLen, 0, -tailLen * 0.6, 1.5 + wob2 * 0.5);
      ctx.quadraticCurveTo(0, headR + wob2, headR, 0);
      ctx.closePath();
      const grad = ctx.createRadialGradient(headR * 0.3, 0, 1, headR * 0.3, 0, headR * 1.6);
      grad.addColorStop(0, "#fff3c0");
      grad.addColorStop(0.4, "#ffb020");
      grad.addColorStop(1, "#c02a00");
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = "#ffe08c";
      ctx.beginPath();
      ctx.arc(headR * 0.3, 0, headR * 0.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  // A robed silhouette (tapered — narrow shoulders flaring out to a wide hem) with a glowing
  // ember core at chest height and a handful of small flame wisps drifting around it — no face,
  // no hands, just a caster shape with fire visibly restless around it.
  drawBody(ctx) {
    const r = this.size / 2;
    const t = performance.now() / 1000;
    const breathe = 1 + Math.sin(t * 1.4) * 0.02;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(breathe, breathe);

    // Robe
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(r * 0.75, -r * 0.3, r * 0.95, r);
    ctx.lineTo(-r * 0.95, r);
    ctx.quadraticCurveTo(-r * 0.75, -r * 0.3, 0, -r);
    ctx.closePath();
    const robeGrad = ctx.createLinearGradient(0, -r, 0, r);
    robeGrad.addColorStop(0, "#7a2410");
    robeGrad.addColorStop(1, "#2c0d06");
    ctx.fillStyle = robeGrad;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Hood shadow
    ctx.beginPath();
    ctx.arc(0, -r * 0.55, r * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = "#160502";
    ctx.fill();

    // Ember core glowing inside the hood — the only "face"
    const glowPulse = 0.6 + Math.sin(t * 3) * 0.3;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = glowPulse;
    const coreGlow = ctx.createRadialGradient(0, -r * 0.55, 0, 0, -r * 0.55, r * 0.3);
    coreGlow.addColorStop(0, "#ffe08c");
    coreGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = coreGlow;
    ctx.beginPath();
    ctx.arc(0, -r * 0.55, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Small flame wisps drifting around the body
    for (const w of this.flameWisps) {
      const a = w.angle + t * 0.6;
      const bob = Math.sin(t * 3 + w.seed) * 0.06;
      const wx = Math.cos(a) * r * w.dist, wy = Math.sin(a) * r * (w.dist + bob) * 0.9;
      const flicker = 0.5 + Math.sin(t * 8 + w.seed) * 0.35;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.max(0, flicker);
      ctx.fillStyle = "#ff8a20";
      ctx.beginPath();
      ctx.arc(wx, wy, r * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  draw(ctx) {
    this.drawFireballsInFlight(ctx);
    if (!this.alive && this.deathFadeTimer <= 0) return;
    super.draw(ctx);
  }
}
