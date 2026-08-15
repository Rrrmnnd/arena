// Fire Mage: the first of a planned trio of elemental casters (Fire/Ice/Earth), each its own
// separate character rather than one character with a switchable element. Fire Mage's identity
// is ground control, not direct burst — its only attack right now is a lobbed fireball that
// leaves a patch of lava wherever it actually ends up (on the opponent's own position if it hit
// them, or wherever it struck a wall otherwise), which then burns the opponent (not Fire Mage
// itself — immune to its own lava) for a long while. No ultimate yet — that's still being
// designed; ultimateRatio simply isn't overridden, so no ultimate bar shows in its HUD yet.
//
// Deliberately excluded from the Twitch integration's random-battle roster for now (see
// ROSTER_TWITCH in main.js) — it's still new/untested and the request was explicit about that.

const FIREMAGE_MAX_HP = 100;  // no melee of its own at all right now, purely zone control
const FIREMAGE_SPEED   = 240;
const FIREMAGE_SIZE    = CHAR_BASE_SIZE; // same as Punch Man/Giant/Soldier

const FIREMAGE_FIREBALL_DAMAGE   = 8;
const FIREMAGE_FIREBALL_COOLDOWN = 3.0;
const FIREMAGE_FIREBALL_SPEED    = 480;
const FIREMAGE_FIREBALL_LIFE     = 2.5; // safety timeout in case it somehow never reaches a wall
// The launched fireball's radius — deliberately a touch wider than the mage itself (33 -> 66px
// across vs. the body's 60), since the whole cooldown is spent visibly charging it up to this
// size at the staff head. Note this also IS its hitbox (see updateFireballs), so a fully-charged
// shot is much harder to slip past than the small bolt this used to fire.
const FIREMAGE_FIREBALL_RADIUS   = 33;

// Casting is a three-beat swing rather than an instant spawn: the staff winds back, whips
// forward to point straight at the target — and the fireball is released at exactly that peak,
// not when the cast started, so the shot visibly comes off the end of the swing — then eases
// back to its resting position. See castSwingAmount/castFlash and update()'s cast state machine.
// The three together are well under FIREMAGE_FIREBALL_COOLDOWN, so a cast always finishes its
// animation long before the next one is allowed to begin.
const FIREMAGE_CAST_WINDUP  = 0.20;
const FIREMAGE_CAST_SWING   = 0.12;
const FIREMAGE_CAST_RECOVER = 0.38;

// The actual point of the character: wherever a fireball ends up — the opponent's own current
// position if it hit them, or the wall it struck otherwise — a patch of ground catches fire and
// keeps burning long after the fireball itself is gone. Opponent-only (Fire Mage itself is
// immune to its own lava, unlike the first pass of this) — same 5/sec overall rate as before,
// just ticked in smaller, more frequent steps (1 dmg every 0.2s) so standing in it a moment
// doesn't feel like an all-or-nothing single big hit.
const FIREMAGE_LAVA_DURATION      = 13.0;
const FIREMAGE_LAVA_TICK_DAMAGE   = 1;
const FIREMAGE_LAVA_TICK_INTERVAL = 0.2;
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
    this.castPhase = null; // null | "windup" | "swing" | "recover" — see update()
    this.castTimer = 0;

    // Fixed per-instance layout so the trim runes and rising embers don't reroll (and visibly
    // crawl) every single frame.
    this.bodySeed = Math.random() * Math.PI * 2;
    this.embers = Array.from({ length: 6 }, () => ({
      angle: Math.random() * Math.PI * 2,
      dist: 0.3 + Math.random() * 0.45,
      seed: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 0.5,
      size: 0.05 + Math.random() * 0.05,
    }));
  }

  // 0 at rest, negative while wound back, up to 1 at the peak of the forward swing. drawStaff
  // reads this to blend the staff between "held upright at the mage's side" and "thrust out
  // pointing straight at the target", so the whole motion falls out of this single number.
  get castSwingAmount() {
    if (!this.castPhase) return 0;
    if (this.castPhase === "windup") {
      const p = 1 - this.castTimer / FIREMAGE_CAST_WINDUP;
      return -0.32 * (p * p * (3 - 2 * p)); // smoothstep back
    }
    if (this.castPhase === "swing") {
      const p = 1 - this.castTimer / FIREMAGE_CAST_SWING;
      return -0.32 + 1.32 * (1 - (1 - p) * (1 - p)); // ease-out: fastest at the start of the whip
    }
    const p = 1 - this.castTimer / FIREMAGE_CAST_RECOVER;
    return 1 - (p * p * (3 - 2 * p)); // smoothstep back to rest
  }

  // Staff-head brightness: builds through the forward swing, peaks exactly at release, decays
  // over the recovery.
  get castFlash() {
    if (this.castPhase === "swing") return 1 - this.castTimer / FIREMAGE_CAST_SWING;
    if (this.castPhase === "recover") return Math.max(0, this.castTimer / FIREMAGE_CAST_RECOVER);
    return 0;
  }

  // 0..1 — how far along the next shot is from being ready, which drawStaff renders as an orb
  // physically growing at the staff head over the whole cooldown, so the wait reads as visibly
  // gathering power rather than as dead time.
  //
  // Held pinned at 1 through the windup and the swing itself: fireballTimer is reset the instant
  // a cast BEGINS, so without this the fully-charged orb would snap back to nothing at the very
  // moment the mage starts winding up to throw it. It's only once the shot has actually left
  // (recover onward) that the charge legitimately reads as spent and starts over.
  get chargeRatio() {
    if (this.castPhase === "windup" || this.castPhase === "swing") return 1;
    return Math.max(0, Math.min(1, 1 - this.fireballTimer / FIREMAGE_FIREBALL_COOLDOWN));
  }

  // Called at the peak of the swing (not when the cast began) — see update(). The opponent can
  // die or vanish mid-animation, in which case the swing still plays out, it just produces
  // nothing.
  releaseFireball(opponent) {
    if (!opponent || !opponent.alive) return;
    const angle = Math.atan2(opponent.y - this.y, opponent.x - this.x);
    // Clear of the mage's own body, so a ball this size doesn't spawn half-buried in it
    const spawnDist = this.size / 2 + FIREMAGE_FIREBALL_RADIUS * 0.85;
    this.fireballs.push(new Fireball(
      this.x + Math.cos(angle) * spawnDist, this.y + Math.sin(angle) * spawnDist,
      angle, FIREMAGE_FIREBALL_SPEED
    ));
    spawnImpactParticles(
      this.x + Math.cos(angle) * spawnDist, this.y + Math.sin(angle) * spawnDist,
      ["#ffcf40", "#ff6a20"], 14, 1.1, 0
    );
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
        // Matched to the ball's actual drawn size, so what looks like a hit is a hit
        if (dist <= opponent.size / 2 + FIREMAGE_FIREBALL_RADIUS) {
          opponent.takeDamage(FIREMAGE_FIREBALL_DAMAGE);
          landX = opponent.x;
          landY = opponent.y;
          gone = true;
        }
      }

      if (!gone) {
        // Stops against the wall's INNER FACE with its own radius accounted for, rather than
        // waiting for its centre to leave the arena entirely: at 480px/sec it covers ~8px a
        // frame, so the centre-only test let it visibly punch a good chunk of the way through
        // the border (head radius + up to a frame of travel) before winking out. Clamping the
        // landing point to the same face also keeps the lava hugging the wall instead of
        // straddling it.
        const left   = ARENA.x + ARENA_BORDER + FIREMAGE_FIREBALL_RADIUS;
        const right  = ARENA.x + ARENA.w - ARENA_BORDER - FIREMAGE_FIREBALL_RADIUS;
        const top    = ARENA.y + ARENA_BORDER + FIREMAGE_FIREBALL_RADIUS;
        const bottom = ARENA.y + ARENA.h - ARENA_BORDER - FIREMAGE_FIREBALL_RADIUS;
        if (f.x < left || f.x > right || f.y < top || f.y > bottom) {
          landX = Math.min(right, Math.max(left, f.x));
          landY = Math.min(bottom, Math.max(top, f.y));
          f.x = landX;
          f.y = landY;
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
        // Opponent only — Fire Mage is immune to its own lava.
        if (opponent && opponent.alive) {
          const dist = Math.hypot(opponent.x - lp.x, opponent.y - lp.y);
          if (dist <= FIREMAGE_LAVA_RADIUS + opponent.size / 2) {
            opponent.takeDamage(FIREMAGE_LAVA_TICK_DAMAGE, FIREMAGE_LAVA_DAMAGE_COLOR);
            spawnImpactParticles(opponent.x, opponent.y - opponent.size * 0.2, ["#ff7a1a", "#ffcf40"], 6, 0.6, 0);
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

    // Cast animation runs to completion on its own once started — deliberately NOT gated on
    // stunTimer below, so getting hit mid-swing doesn't strand the staff frozen halfway out.
    if (this.castPhase) {
      this.castTimer -= dt;
      if (this.castTimer <= 0) {
        if (this.castPhase === "windup") {
          this.castPhase = "swing";
          this.castTimer = FIREMAGE_CAST_SWING;
        } else if (this.castPhase === "swing") {
          this.releaseFireball(opponent); // the shot leaves the staff at the peak of the swing
          this.castPhase = "recover";
          this.castTimer = FIREMAGE_CAST_RECOVER;
        } else {
          this.castPhase = null;
        }
      }
    }

    if (this.stunTimer > 0) return;

    if (this.fireballTimer > 0) this.fireballTimer -= dt;
    if (opponent && opponent.alive && this.fireballTimer <= 0 && this.canAttack && !this.castPhase) {
      this.fireballTimer += FIREMAGE_FIREBALL_COOLDOWN;
      this.castPhase = "windup";
      this.castTimer = FIREMAGE_CAST_WINDUP;
    }
  }

  // Ground-level burning patches — drawn under BOTH fighters (see Character.drawGroundEffects
  // and main.js's drawFrame), so whoever's standing in one visibly stands on top of it. Grows in
  // from nothing when it lands, holds, then fades out over its last stretch rather than just
  // popping out of existence.
  drawGroundEffects(ctx) {
    if (!this.lavaPatches.length) return;
    const t = performance.now() / 1000;

    // A patch that lands against a wall would otherwise paint straight over the arena border
    // (its radius is far bigger than the fireball's), so the whole layer is clipped to the
    // playable interior — pooling flat against the wall instead of spilling through it.
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      ARENA.x + ARENA_BORDER, ARENA.y + ARENA_BORDER,
      ARENA.w - ARENA_BORDER * 2, ARENA.h - ARENA_BORDER * 2
    );
    ctx.clip();

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

    ctx.restore(); // end arena clip
  }

  // The launched ball. Big enough now (see FIREMAGE_FIREBALL_RADIUS) that a single flat blob
  // would look cheap, so it's built in layers: an outer glow, a churning flame silhouette whose
  // rim wobbles on several out-of-phase waves, a white-hot core, and a trail of shed embers
  // streaming out behind it.
  drawFireballsInFlight(ctx) {
    const t = performance.now() / 1000;
    const R = FIREMAGE_FIREBALL_RADIUS;
    for (const f of this.fireballs) {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.angle);

      // Outer heat glow
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const glow = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R * 1.7);
      glow.addColorStop(0, "rgba(255,150,40,0.55)");
      glow.addColorStop(0.5, "rgba(255,90,10,0.22)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Trailing embers shed behind the ball
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 5; i++) {
        const p = ((t * 2.2 + f.seed + i * 0.37) % 1);
        const tx = -R * (0.7 + p * 1.9);
        const ty = Math.sin(t * 7 + i * 2.1 + f.seed) * R * 0.4 * p;
        ctx.globalAlpha = (1 - p) * 0.7;
        ctx.fillStyle = p > 0.5 ? "#ff6a18" : "#ffcf5c";
        ctx.beginPath();
        ctx.arc(tx, ty, R * 0.2 * (1 - p * 0.7), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Churning flame body — a ring of points each riding its own wave, so the outline boils
      // rather than staying a clean circle
      ctx.beginPath();
      const pts = 20;
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2;
        const wob = 1
          + Math.sin(a * 3 + t * 9 + f.seed) * 0.11
          + Math.sin(a * 5 - t * 13 + f.seed * 1.7) * 0.07;
        // Stretched slightly along the direction of travel, squashed across it
        const rad = R * wob;
        const px = Math.cos(a) * rad * 1.1, py = Math.sin(a) * rad * 0.92;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      const grad = ctx.createRadialGradient(R * 0.22, -R * 0.12, R * 0.06, 0, 0, R * 1.15);
      grad.addColorStop(0, "#fffbe0");
      grad.addColorStop(0.28, "#ffdc5c");
      grad.addColorStop(0.6, "#ff8a14");
      grad.addColorStop(1, "#c22e02");
      ctx.fillStyle = grad;
      ctx.fill();

      // White-hot core
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.65 + Math.sin(t * 14 + f.seed) * 0.2;
      const core = ctx.createRadialGradient(R * 0.18, -R * 0.1, 0, R * 0.18, -R * 0.1, R * 0.55);
      core.addColorStop(0, "#ffffff");
      core.addColorStop(0.5, "rgba(255,214,120,0.5)");
      core.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(R * 0.18, -R * 0.1, R * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.restore();
    }
  }

  // The staff. Its whole motion comes off castSwingAmount: at rest (0) it's held upright at the
  // mage's side, at the peak of a cast (1) it's thrust out pointing straight along facingAngle,
  // and a small negative value winds it back the other way first. Interpolating the ROTATION
  // between those two poses (rather than, say, sliding it around) is what gives the swing its
  // arc. Drawn after the body so it passes in front while swinging across.
  drawStaff(ctx, r, t) {
    const swing = this.castSwingAmount;
    const flash = this.castFlash;
    const side = Math.cos(this.facingAngle) >= 0 ? 1 : -1;

    // Rest pose: near-vertical, leaning slightly toward the target. Aim pose: straight along
    // facingAngle. The difference is normalised into [-PI, PI] so the blend always takes the
    // short way round instead of occasionally whipping the long way about.
    const restRot = -Math.PI / 2 + side * 0.18;
    let delta = this.facingAngle - restRot;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const rot = restRot + delta * swing;

    // The grip sits at the mage's side and pushes a little way toward the target through the
    // swing, so the thrust reads as coming from the body rather than the staff merely spinning.
    const gripX = side * r * 0.5 + Math.cos(this.facingAngle) * r * 0.35 * Math.max(0, swing);
    const gripY = r * 0.2 + Math.sin(this.facingAngle) * r * 0.35 * Math.max(0, swing)
      + Math.sin(t * 1.7 + this.bodySeed) * r * 0.04;

    ctx.save();
    ctx.translate(gripX, gripY);
    ctx.rotate(rot + Math.PI / 2); // +90° so the shaft's local -Y (its length) lies along `rot`

    const topY = -r * 1.35;
    const botY = r * 0.5;

    // Shaft — tapered, with a lit edge down one side so it reads as a round pole not a flat stick
    const shaftW = r * 0.1;
    ctx.beginPath();
    ctx.moveTo(-shaftW * 0.75, topY);
    ctx.lineTo(shaftW * 0.75, topY);
    ctx.lineTo(shaftW, botY);
    ctx.lineTo(-shaftW, botY);
    ctx.closePath();
    const shaftGrad = ctx.createLinearGradient(-shaftW, 0, shaftW, 0);
    shaftGrad.addColorStop(0, "#2a1810");
    shaftGrad.addColorStop(0.38, "#8a552f");
    shaftGrad.addColorStop(0.62, "#5e361c");
    shaftGrad.addColorStop(1, "#20120a");
    ctx.fillStyle = shaftGrad;
    ctx.fill();

    // Metal bindings
    for (const by of [topY + r * 0.26, botY - r * 0.2]) {
      const bandW = shaftW * 1.5;
      const bandGrad = ctx.createLinearGradient(-bandW, 0, bandW, 0);
      bandGrad.addColorStop(0, "#3a3128");
      bandGrad.addColorStop(0.4, "#b9a578");
      bandGrad.addColorStop(1, "#2a231c");
      ctx.fillStyle = bandGrad;
      ctx.fillRect(-bandW, by, bandW * 2, r * 0.1);
    }

    // Prongs cradling the gem
    ctx.strokeStyle = "#5c4830";
    ctx.lineWidth = r * 0.062;
    ctx.lineCap = "round";
    for (const px of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(px * shaftW * 0.7, topY + r * 0.05);
      ctx.quadraticCurveTo(px * r * 0.3, topY - r * 0.04, px * r * 0.17, topY - r * 0.3);
      ctx.stroke();
    }

    // Burning gem at the head — flickers constantly, flares hard at the moment of release
    const gemR = r * 0.24 * (1 + Math.sin(t * 9 + this.bodySeed) * 0.06 + flash * 0.4);
    const gemY = topY - r * 0.22;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const haloR = gemR * (3.0 + flash * 2.6);
    const halo = ctx.createRadialGradient(0, gemY, 0, 0, gemY, haloR);
    halo.addColorStop(0, `rgba(255,196,100,${(0.55 + flash * 0.4).toFixed(3)})`);
    halo.addColorStop(0.45, `rgba(255,110,20,${(0.2 + flash * 0.3).toFixed(3)})`);
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, gemY, haloR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const gemGrad = ctx.createRadialGradient(-gemR * 0.3, gemY - gemR * 0.3, gemR * 0.08, 0, gemY, gemR);
    gemGrad.addColorStop(0, "#fffbe8");
    gemGrad.addColorStop(0.35, "#ffc247");
    gemGrad.addColorStop(0.7, "#f2600c");
    gemGrad.addColorStop(1, "#8a1f02");
    ctx.fillStyle = gemGrad;
    ctx.beginPath();
    ctx.arc(0, gemY, gemR, 0, Math.PI * 2);
    ctx.fill();

    // The gathering shot, growing at the gem across the whole cooldown up to the exact size it
    // will launch at. Ramped rather than linear so it spends a while as a small ember and then
    // visibly balloons over the last stretch — that acceleration is what reads as "charging"
    // instead of just "a circle slowly scaling". Drawn in the staff's local frame, so it swings
    // along with the head.
    const charge = this.chargeRatio;
    if (charge > 0.02) {
      const ramp = 0.1 + 0.9 * Math.pow(charge, 1.5);
      const ballR = FIREMAGE_FIREBALL_RADIUS * ramp;
      // Only really shakes once it's nearly full — an almost-ready shot straining to be let go
      const strain = Math.pow(charge, 4);
      const jitterX = Math.sin(t * 34 + this.bodySeed) * ballR * 0.05 * strain;
      const jitterY = Math.cos(t * 41 + this.bodySeed) * ballR * 0.05 * strain;
      const cx = jitterX, cy = gemY - ballR * 0.35 + jitterY;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const cGlow = ctx.createRadialGradient(cx, cy, ballR * 0.1, cx, cy, ballR * 1.8);
      cGlow.addColorStop(0, `rgba(255,170,60,${(0.35 + 0.3 * charge).toFixed(3)})`);
      cGlow.addColorStop(0.5, `rgba(255,90,10,${(0.12 + 0.15 * charge).toFixed(3)})`);
      cGlow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = cGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, ballR * 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      const pts = 18;
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2;
        const wob = 1
          + Math.sin(a * 3 + t * 8 + this.bodySeed) * 0.1
          + Math.sin(a * 5 - t * 11) * 0.06;
        const px = cx + Math.cos(a) * ballR * wob, py = cy + Math.sin(a) * ballR * wob;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      const cGrad = ctx.createRadialGradient(cx + ballR * 0.2, cy - ballR * 0.2, ballR * 0.05, cx, cy, ballR * 1.1);
      cGrad.addColorStop(0, "#fffbe0");
      cGrad.addColorStop(0.3, "#ffd85a");
      cGrad.addColorStop(0.62, "#ff8614");
      cGrad.addColorStop(1, "#bd2c02");
      ctx.fillStyle = cGrad;
      ctx.globalAlpha = 0.55 + 0.45 * charge; // faint while it's still gathering, solid once full
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  // A round hooded caster: the circular body IS the robe, with a peaked hood over the top, a
  // shadowed face cavity holding two ember eyes, a shoulder mantle, a gold clasp and a band of
  // glowing runes around the hem. The circle keeps it consistent with the rest of the cast while
  // the hood/eyes/mantle are what make it read as a person rather than a ball, and the whole
  // palette (ember gradient, glowing runes, drifting sparks) carries the fire element.
  drawBody(ctx) {
    const r = this.size / 2;
    const t = performance.now() / 1000;
    const breathe = 1 + Math.sin(t * 1.4 + this.bodySeed) * 0.02;
    const flash = this.castFlash;
    const side = Math.cos(this.facingAngle) >= 0 ? 1 : -1; // which way it's facing; the hood tip trails the opposite way

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(breathe, breathe);

    // Contact shadow, so it sits in the arena rather than floating over it
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.ellipse(r * 0.1, r * 0.93, r * 0.72, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Robe — the body circle. Lit from the upper left, deepening to near-black at the hem.
    const robeGrad = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.06, 0, 0, r);
    robeGrad.addColorStop(0, "#f5813f");
    robeGrad.addColorStop(0.45, "#c4501f");
    robeGrad.addColorStop(0.8, "#832d0f");
    robeGrad.addColorStop(1, "#521806");
    ctx.fillStyle = robeGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Everything painted onto the robe is clipped to it, so no detail spills past the silhouette
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.995, 0, Math.PI * 2);
    ctx.clip();

    // Robe folds — a few soft vertical creases fanning out from under the mantle
    ctx.strokeStyle = "rgba(70,20,5,0.3)";
    ctx.lineCap = "round";
    for (let i = -2; i <= 2; i++) {
      ctx.lineWidth = r * 0.05;
      ctx.beginPath();
      ctx.moveTo(i * r * 0.24, r * 0.18);
      ctx.quadraticCurveTo(i * r * 0.3, r * 0.6, i * r * 0.36, r * 1.05);
      ctx.stroke();
    }

    // Hem band with glowing runes — the "professional mage" trim
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(64,20,6,0.55)";
    ctx.lineWidth = r * 0.19;
    ctx.stroke();
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * 0.16 + (i / 6) * Math.PI * 0.68; // spread across the lower arc only
      const pulse = 0.45 + Math.sin(t * 2.4 + i * 1.1 + this.bodySeed) * 0.35 + flash * 0.4;
      ctx.globalAlpha = Math.max(0, Math.min(1, pulse));
      ctx.fillStyle = "#ffb23c";
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86, r * 0.035, r * 0.075, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Shoulder mantle draped over the upper body
    ctx.beginPath();
    ctx.moveTo(-r * 0.99, -r * 0.05);
    ctx.quadraticCurveTo(-r * 0.6, r * 0.42, 0, r * 0.36);
    ctx.quadraticCurveTo(r * 0.6, r * 0.42, r * 0.99, -r * 0.05);
    ctx.quadraticCurveTo(r * 0.5, -r * 0.52, 0, -r * 0.5);
    ctx.quadraticCurveTo(-r * 0.5, -r * 0.52, -r * 0.99, -r * 0.05);
    ctx.closePath();
    const mantleGrad = ctx.createLinearGradient(0, -r * 0.5, 0, r * 0.4);
    mantleGrad.addColorStop(0, "#d15f2b");
    mantleGrad.addColorStop(1, "#7d290e99");
    ctx.fillStyle = mantleGrad;
    ctx.fill();

    ctx.restore(); // end robe clip

    // Hood — a proper pointed wizard's cowl rather than a dome, its tip drawn up and tilted back
    // away from whichever way the mage is facing. Kept under ~1.25r tall so the peak still clears
    // the floating HP bar that sits at size/2 + 22 above the character.
    const back = -side * r * 0.3; // tip trails behind the facing direction
    ctx.beginPath();
    ctx.moveTo(-r * 0.74, -r * 0.18);
    ctx.quadraticCurveTo(-r * 0.86, -r * 0.82, back - r * 0.12, -r * 1.03);
    ctx.quadraticCurveTo(back + r * 0.02, -r * 1.28, back + r * 0.2, -r * 1.24); // the tip itself
    ctx.quadraticCurveTo(r * 0.3, -r * 1.0, r * 0.68, -r * 0.66);
    ctx.quadraticCurveTo(r * 0.84, -r * 0.42, r * 0.74, -r * 0.18);
    ctx.quadraticCurveTo(0, -r * 0.02, -r * 0.74, -r * 0.18);
    ctx.closePath();
    const hoodGrad = ctx.createLinearGradient(-r * 0.5, -r * 1.1, r * 0.5, -r * 0.1);
    hoodGrad.addColorStop(0, "#ef7233");
    hoodGrad.addColorStop(0.55, "#a83e1c");
    hoodGrad.addColorStop(1, "#54190a");
    ctx.fillStyle = hoodGrad;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Face cavity — deep shadow under the hood, narrower than the hood itself so a clear rim of
    // cowl reads all the way around the opening
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.44, r * 0.42, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#100309";
    ctx.fill();

    // Ember eyes — the single strongest "this is a person" cue on the whole design
    const eyePulse = 0.75 + Math.sin(t * 3.1 + this.bodySeed) * 0.25 + flash * 0.5;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = Math.max(0, Math.min(1, eyePulse));
    for (const ex of [-r * 0.19, r * 0.19]) {
      const eyeGlow = ctx.createRadialGradient(ex, -r * 0.44, 0, ex, -r * 0.44, r * 0.2);
      eyeGlow.addColorStop(0, "#fff0c0");
      eyeGlow.addColorStop(0.35, "#ffa023");
      eyeGlow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = eyeGlow;
      ctx.beginPath();
      ctx.arc(ex, -r * 0.44, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff6dc";
      ctx.beginPath();
      ctx.ellipse(ex, -r * 0.44, r * 0.055, r * 0.085, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Gold clasp holding the mantle at the throat
    const claspY = -r * 0.03;
    const claspGrad = ctx.createLinearGradient(0, claspY - r * 0.1, 0, claspY + r * 0.1);
    claspGrad.addColorStop(0, "#ffdf9a");
    claspGrad.addColorStop(1, "#8a6216");
    ctx.fillStyle = claspGrad;
    ctx.beginPath();
    ctx.ellipse(0, claspY, r * 0.13, r * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.5 + Math.sin(t * 2.8) * 0.2;
    ctx.fillStyle = "#ff8c2a";
    ctx.beginPath();
    ctx.arc(0, claspY, r * 0.055, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Outline, tying the hood and robe together as one silhouette
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    // Embers drifting up off the robe, looping back down as they fade
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const e of this.embers) {
      const cycle = ((t * e.speed + e.seed) % 2) / 2; // 0..1
      const ex = Math.cos(e.angle) * r * e.dist + Math.sin(t * 2 + e.seed) * r * 0.1;
      const ey = r * 0.6 - cycle * r * 2.0;
      ctx.globalAlpha = Math.max(0, Math.sin(cycle * Math.PI)) * 0.8;
      ctx.fillStyle = cycle > 0.55 ? "#ff7a20" : "#ffcf6b";
      ctx.beginPath();
      ctx.arc(ex, ey, r * e.size * (1 - cycle * 0.45), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    this.drawStaff(ctx, r, t);

    ctx.restore();
  }

  draw(ctx) {
    this.drawFireballsInFlight(ctx);
    if (!this.alive && this.deathFadeTimer <= 0) return;
    super.draw(ctx);
  }
}
