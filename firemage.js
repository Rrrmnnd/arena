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
const FIREMAGE_SIZE    = CHAR_BASE_SIZE * 0.85; // a bit smaller than Punch Man — a compact orb, see drawBody

const FIREMAGE_FIREBALL_DAMAGE   = 8;
const FIREMAGE_FIREBALL_COOLDOWN = 3.0;
const FIREMAGE_FIREBALL_SPEED    = 480;
const FIREMAGE_FIREBALL_LIFE     = 2.5; // safety timeout in case it somehow never reaches a wall
const FIREMAGE_FIREBALL_RADIUS   = 8;   // the visual head's own radius — see updateFireballs, which stops it AT the wall's inner face rather than letting it punch through
const FIREMAGE_CAST_FLASH_TIME   = 0.3; // seconds the staff head flares brighter right after releasing a fireball

// The actual point of the character: wherever a fireball ends up — the opponent's own current
// position if it hit them, or the wall it struck otherwise — a patch of ground catches fire and
// keeps burning long after the fireball itself is gone. Opponent-only (Fire Mage itself is
// immune to its own lava, unlike the first pass of this) — same 5/sec overall rate as before,
// just ticked in smaller, more frequent steps (1 dmg every 0.2s) so standing in it a moment
// doesn't feel like an all-or-nothing single big hit.
const FIREMAGE_LAVA_DURATION      = 10.0;
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
    this.castFlashTimer = 0; // >0 right after a cast: the staff head flares — see drawStaff

    // Fixed per-instance layout so the crust cracks and rising embers don't reroll (and visibly
    // crawl) every single frame.
    this.bodySeed = Math.random() * Math.PI * 2;
    this.moltenCracks = this.generateMoltenCracks();
    this.embers = Array.from({ length: 6 }, () => ({
      angle: Math.random() * Math.PI * 2,
      dist: 0.3 + Math.random() * 0.45,
      seed: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 0.5,
      size: 0.05 + Math.random() * 0.05,
    }));
  }

  // Jagged seams of exposed lava running outward across the crust, in UNIT-CIRCLE space
  // (roughly -1..1; drawBody scales by the actual radius). Each starts near the middle and
  // walks outward with a drifting heading, so they fork out across the surface rather than
  // sitting as tidy radial spokes.
  generateMoltenCracks() {
    const cracks = [];
    const count = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      let a = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      let d = 0.12;
      const pts = [{ x: Math.cos(a) * d, y: Math.sin(a) * d }];
      const steps = 3 + Math.floor(Math.random() * 3);
      for (let s = 0; s < steps; s++) {
        a += (Math.random() - 0.5) * 0.85;
        d += 0.15 + Math.random() * 0.13;
        pts.push({ x: Math.cos(a) * d, y: Math.sin(a) * d });
      }
      cracks.push({ pts, seed: Math.random() * Math.PI * 2, width: 0.045 + Math.random() * 0.035 });
    }
    return cracks;
  }

  throwFireball(opponent) {
    const angle = Math.atan2(opponent.y - this.y, opponent.x - this.x);
    const spawnDist = this.size / 2 + 8;
    this.castFlashTimer = FIREMAGE_CAST_FLASH_TIME;
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
    if (this.castFlashTimer > 0) this.castFlashTimer -= dt;
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

  // The staff, floating alongside the orb on whichever side the opponent is on — a tapered dark
  // shaft with metal bindings, a set of prongs cradling a burning gem at the head, and a soft
  // light it casts on its surroundings. Drawn BEFORE the body so the orb overlaps the shaft's
  // lower end and it reads as carried rather than pasted alongside. Kept near-upright with only
  // a lean toward the target rather than rotating fully to face it: a staff swinging around to
  // point straight down whenever the opponent is below reads as broken, not as aiming.
  drawStaff(ctx, r, t) {
    const side = Math.cos(this.facingAngle) >= 0 ? 1 : -1;
    const lean = side * 0.16; // radians off vertical, tipping the head toward the target
    const bob = Math.sin(t * 1.7 + this.bodySeed) * r * 0.05;
    const flash = Math.max(0, this.castFlashTimer / FIREMAGE_CAST_FLASH_TIME);

    ctx.save();
    ctx.translate(side * r * 0.92, bob);
    ctx.rotate(lean);

    const topY = -r * 1.5;
    const botY = r * 1.05;

    // Shaft — tapered (thicker at the grip, thinner toward the head) with a lit edge down one
    // side so it reads as a round pole rather than a flat stick.
    const shaftW = r * 0.115;
    ctx.beginPath();
    ctx.moveTo(-shaftW * 0.78, topY);
    ctx.lineTo(shaftW * 0.78, topY);
    ctx.lineTo(shaftW, botY);
    ctx.lineTo(-shaftW, botY);
    ctx.closePath();
    const shaftGrad = ctx.createLinearGradient(-shaftW, 0, shaftW, 0);
    shaftGrad.addColorStop(0, "#1c0f08");
    shaftGrad.addColorStop(0.38, "#57331c");
    shaftGrad.addColorStop(0.62, "#3a2011");
    shaftGrad.addColorStop(1, "#140a05");
    ctx.fillStyle = shaftGrad;
    ctx.fill();

    // Metal bindings
    for (const by of [topY + r * 0.3, botY - r * 0.42]) {
      const bandW = shaftW * 1.5;
      const bandGrad = ctx.createLinearGradient(-bandW, 0, bandW, 0);
      bandGrad.addColorStop(0, "#3a3128");
      bandGrad.addColorStop(0.4, "#9a8b6c");
      bandGrad.addColorStop(1, "#2a231c");
      ctx.fillStyle = bandGrad;
      ctx.fillRect(-bandW, by, bandW * 2, r * 0.11);
    }

    // Prongs cradling the gem
    ctx.strokeStyle = "#4a3a2a";
    ctx.lineWidth = r * 0.07;
    ctx.lineCap = "round";
    for (const px of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(px * shaftW * 0.7, topY + r * 0.06);
      ctx.quadraticCurveTo(px * r * 0.34, topY - r * 0.05, px * r * 0.2, topY - r * 0.34);
      ctx.stroke();
    }

    // Burning gem at the head — flickers constantly, flares on a cast
    const gemR = r * 0.27 * (1 + Math.sin(t * 9 + this.bodySeed) * 0.06 + flash * 0.35);
    const gemY = topY - r * 0.24;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(0, gemY, 0, 0, gemY, gemR * (3.2 + flash * 2.2));
    halo.addColorStop(0, `rgba(255,190,90,${(0.5 + flash * 0.4).toFixed(3)})`);
    halo.addColorStop(0.45, `rgba(255,110,20,${(0.18 + flash * 0.25).toFixed(3)})`);
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, gemY, gemR * (3.2 + flash * 2.2), 0, Math.PI * 2);
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

    ctx.restore();
  }

  // A molten orb: a dark cooled crust with lava glowing up through jagged seams, lit from the
  // upper left with a rim-light bounce along the lower right so it reads as a genuine sphere
  // rather than a flat disc, plus embers drifting up off it. Paired with the staff (drawn first,
  // see drawStaff) — the whole character is just those two things.
  drawBody(ctx) {
    const r = this.size / 2;
    const t = performance.now() / 1000;
    const breathe = 1 + Math.sin(t * 1.4 + this.bodySeed) * 0.022;

    ctx.save();
    ctx.translate(this.x, this.y);

    this.drawStaff(ctx, r, t);

    ctx.scale(breathe, breathe);

    // Contact shadow, so the orb sits in the arena rather than floating over it
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.ellipse(r * 0.12, r * 0.92, r * 0.78, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Crust
    // Kept a good deal brighter than a literal cooled crust would be: at the size this actually
    // renders in-game (~50px across) a realistically dark rock just reads as a muddy blob next
    // to the rest of the cast, so the mid-tones are pushed up until the sphere still reads at a
    // glance while the darkest rim keeps the round shading.
    const bodyGrad = ctx.createRadialGradient(-r * 0.33, -r * 0.38, r * 0.06, 0, 0, r);
    bodyGrad.addColorStop(0, "#d97a34");
    bodyGrad.addColorStop(0.4, "#a04516");
    bodyGrad.addColorStop(0.78, "#5c220a");
    bodyGrad.addColorStop(1, "#2a1004");
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Molten seams, clipped to the sphere so they never spill past its edge
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.99, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const c of this.moltenCracks) {
      const pulse = 0.55 + Math.sin(t * 2.2 + c.seed) * 0.45;
      // Wide dim under-glow first, then the hot thin core on top — the two passes together are
      // what make a seam look like light escaping from inside rather than a painted-on line.
      ctx.strokeStyle = `rgba(255,96,10,${(0.3 * pulse).toFixed(3)})`;
      ctx.lineWidth = c.width * r * 2.6;
      ctx.beginPath();
      c.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * r, p.y * r) : ctx.lineTo(p.x * r, p.y * r)));
      ctx.stroke();

      ctx.strokeStyle = `rgba(255,214,140,${(0.85 * pulse).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.7, c.width * r);
      ctx.beginPath();
      c.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * r, p.y * r) : ctx.lineTo(p.x * r, p.y * r)));
      ctx.stroke();
    }

    // Molten core bleeding through the middle
    const corePulse = 0.5 + Math.sin(t * 2.6 + this.bodySeed) * 0.3;
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.62);
    core.addColorStop(0, `rgba(255,186,80,${(0.6 * corePulse).toFixed(3)})`);
    core.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Rim light along the shadow side — the single cheapest cue that this is a sphere
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(255,130,45,0.5)";
    ctx.lineWidth = r * 0.09;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.95, Math.PI * 0.05, Math.PI * 0.85);
    ctx.stroke();
    ctx.restore();

    // Specular highlight
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#ffd9a8";
    ctx.beginPath();
    ctx.ellipse(-r * 0.36, -r * 0.42, r * 0.2, r * 0.13, -0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    // Embers drifting up off the crust, looping back to the bottom as they fade out
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const e of this.embers) {
      const cycle = ((t * e.speed + e.seed) % 2) / 2; // 0..1
      const ex = Math.cos(e.angle) * r * e.dist + Math.sin(t * 2 + e.seed) * r * 0.1;
      const ey = r * 0.5 - cycle * r * 1.9;
      ctx.globalAlpha = Math.max(0, Math.sin(cycle * Math.PI)) * 0.85;
      ctx.fillStyle = cycle > 0.55 ? "#ff7a20" : "#ffcf6b";
      ctx.beginPath();
      ctx.arc(ex, ey, r * e.size * (1 - cycle * 0.45), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.restore();
  }

  draw(ctx) {
    this.drawFireballsInFlight(ctx);
    if (!this.alive && this.deathFadeTimer <= 0) return;
    super.draw(ctx);
  }
}
