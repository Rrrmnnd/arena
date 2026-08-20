// Archer: a slow, deliberate bowman. It holds a single draw for ARCHER_CHARGE_TIME and looses at
// the end of it — nothing else makes it shoot, and closing the distance doesn't rush it. So
// unlike Gunner's stream of fire or Demon's quick throws, every arrow is a scheduled event you
// can watch coming from the bow itself.
//
// The damage is flat; the payoff is Bleed. Every arrow that lands stacks a vulnerability debuff
// on the target (up to BLEED_MAX_STACKS), and each stack raises ALL damage that target takes —
// see Character.applyBleed. So the Archer's own arrows hit harder the longer a fight runs, and so
// does everything else in the arena.

const ARCHER_MAX_HP = 100;
const ARCHER_SPEED  = 240; // same as Fire Mage

const ARCHER_CHARGE_TIME = 4.0; // seconds of draw per shot; it looses the moment this fills
const ARCHER_DAMAGE      = 15;  // flat, before the target's own bleed multiplier is applied

const ARCHER_ARROW_SPEED  = 2000; // px/sec — fast enough that dodging a loosed arrow isn't realistic
const ARCHER_ARROW_LIFE   = 2.5;  // safety timeout; a straight line in a bounded arena always hits a wall first
const ARCHER_ARROW_RADIUS = 7;    // hit radius, and how far short of a wall it stops

const ARCHER_LOOSE_ANIM = 0.18; // seconds the bow-arm snaps forward after release, purely cosmetic

// Ultimate — Sun Shot. Roots the archer in place for a five-second draw, looses a single arrow
// straight up out of the top of the screen, and pulls a sun down onto the opponent. Landing it is
// an outright win, not damage: this is meant to be the most oppressive button in the game.
//
// The only counterplay is the channel itself. Nothing interrupts it except the archer dying — not
// stuns, not knockback, not damage — so the opponent's one answer is to kill it inside those five
// seconds. A stun-based interrupt was considered and rejected: half the roster has one, and it
// would have turned the ultimate into something that simply never resolves.
const ARCHER_ULT_COOLDOWN   = 10.0;
const ARCHER_ULT_CHARGE     = 5.0;  // rooted, drawing, sky darkening
const ARCHER_ULT_ASCEND     = 0.55; // the arrow climbing out of frame
const ARCHER_ULT_HANG       = 0.7;  // the beat after it vanishes, before the sky splits
const ARCHER_ULT_DESCEND    = 1.7;  // the sun falling
const ARCHER_ULT_CRUSH      = 1.2;  // sitting on the flattened opponent before the round is called

// Hou Yi: the archer of the ten-suns myth. Crimson and gold rather than the forest-ranger greens
// this character started in — reads as a mythic figure, and keeps it apart from Demon's darker red.
const ARCHER_ROBE        = "#a81f28";
const ARCHER_ROBE_DARK   = "#5c0f16";
const ARCHER_ROBE_LIGHT  = "#d4333c";
const ARCHER_GOLD        = "#e8b23c";
const ARCHER_GOLD_DK     = "#8a6410";
const ARCHER_HAIR        = "#1d1a19";
const ARCHER_LEATHER     = "#8a5a2b";
const ARCHER_LEATHER_DK  = "#3f2611";
const ARCHER_SKIN        = "#e0b083";
const ARCHER_OUTLINE     = "rgba(0,0,0,0.55)";

// The sun's photosphere granulation, baked once for the whole session into an offscreen canvas
// and then blitted per frame.
//
// It's ~900 soft convection cells; generating them live would cost roughly a millisecond every
// frame of the descent, which is most of a frame budget spent on texture that never changes. The
// bake is square and drawn centred, so callers just scale it to the sun's current radius. The
// cell colours are deliberately near-white — the sun's own body gradient underneath supplies the
// colour, and this only has to break up its flatness.
const ARCHER_SUN_TEX_SIZE = 512;
let archerSunTexture = null;
function archerGetSunTexture() {
  if (archerSunTexture) return archerSunTexture;
  const S = ARCHER_SUN_TEX_SIZE;
  const cv = document.createElement("canvas");
  cv.width = S;
  cv.height = S;
  const c = cv.getContext("2d");
  const R = S / 2;

  for (let i = 0; i < 900; i++) {
    // Distributed by sqrt so the cells stay even across the disc instead of piling into the middle
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * R * 0.99;
    const x = R + Math.cos(a) * d;
    const y = R + Math.sin(a) * d;
    const rad = 6 + Math.random() * 16;
    const bright = Math.random();
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    if (bright > 0.55) {
      g.addColorStop(0, `rgba(255,255,240,${(0.1 + bright * 0.16).toFixed(3)})`);
    } else {
      // The darker lanes between cells, which is what actually makes the surface read as granular
      g.addColorStop(0, `rgba(120,30,0,${(0.06 + (1 - bright) * 0.14).toFixed(3)})`);
    }
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, rad, 0, Math.PI * 2);
    c.fill();
  }

  archerSunTexture = cv;
  return cv;
}

// A loosed arrow: flies dead straight until it reaches the opponent or a wall.
class Arrow {
  constructor(x, y, angle) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.vx = Math.cos(angle) * ARCHER_ARROW_SPEED;
    this.vy = Math.sin(angle) * ARCHER_ARROW_SPEED;
    this.life = ARCHER_ARROW_LIFE;
  }
}

class Archer extends Character {
  constructor(x, y) {
    super({
      x, y,
      size: CHAR_BASE_SIZE,
      color: ARCHER_ROBE,
      maxHp: ARCHER_MAX_HP,
      name: "Archer",
      speed: ARCHER_SPEED,
    });

    this.facingAngle = Math.random() * Math.PI * 2;
    this.charge = 0;     // seconds into the current draw, 0..ARCHER_CHARGE_TIME
    this.arrows = [];
    this.looseTimer = 0; // >0 right after a shot: the bow arm snapping forward
    this.bodySeed = Math.random() * Math.PI * 2; // desyncs the idle bob between two Archers

    // Sun Shot — see the constants above and updateUltimate()
    this.ultimateCooldown = ARCHER_ULT_COOLDOWN;
    this.ultPhase = null;   // null | "charge" | "ascend" | "hang" | "descend" | "crush"
    this.ultTimer = 0;      // counts UP within the current phase
    this.ultTarget = null;  // where the sun is coming down; locked in when the arrow is loosed
    this.ultVictim = null;  // who it's coming down on, held transfixed until it lands
    this.sunSpots = null;   // baked once per cast, see drawSun
    this.skyArrow = null;
    this.sunResting = null; // where a landed sun has come to rest; it stays there for the round
  }

  // 0..1 across the draw. Drives both the bow's animation and the charge bar.
  get chargeRatio() {
    return Math.max(0, Math.min(1, this.charge / ARCHER_CHARGE_TIME));
  }

  // The second bar under the HP shows whichever of the two draws matters right now: the ultimate
  // while it's channelling or on cooldown, the ordinary shot otherwise.
  get ultimateRatio() {
    if (this.ultPhase === "charge") return this.ultTimer / ARCHER_ULT_CHARGE;
    if (this.ultPhase) return 1;
    if (this.ultimateCooldown > 0) return 1 - this.ultimateCooldown / ARCHER_ULT_COOLDOWN;
    return this.chargeRatio;
  }

  get ultimateBarColor() {
    if (this.ultPhase) return "#ff5a1a";
    if (this.ultimateCooldown <= 0) return "#ffd23c";
    return "#8ee86a";
  }

  // Rooted only while actually drawing — see update().
  get isChannelling() {
    return this.ultPhase !== null;
  }

  // Holds the round open from the moment the arrow leaves the bow until the sun has landed, so
  // killing the Archer mid-descent can't win the round out from under a star that is visibly
  // about to flatten you. See Character.blocksRoundEnd.
  get blocksRoundEnd() {
    return this.ultPhase === "ascend" || this.ultPhase === "hang" || this.ultPhase === "descend";
  }

  update(dt, opponent) {
    this.updateArrows(dt, opponent);

    if (this.deathFadeTimer > 0) this.deathFadeTimer -= dt;
    if (!this.alive) {
      // Dying DURING the draw cancels it — that channel is the ultimate's one and only counter.
      // Dying after the arrow is away does not: the shot is gone and a star is already falling,
      // and nothing the opponent does calls it back. blocksRoundEnd keeps the round open so it
      // still gets to land (see Character.blocksRoundEnd and main.js's checkWinner).
      if (this.ultPhase === "charge") {
        this.ultPhase = null;
        this.skyArrow = null;
      } else if (this.ultPhase) {
        this.updateUltimate(dt, opponent);
      }
      return;
    }

    if (this.looseTimer > 0) this.looseTimer -= dt;

    if (opponent && opponent.alive) {
      const dx = opponent.x - this.x, dy = opponent.y - this.y;
      if (Math.hypot(dx, dy) > 0.01) this.facingAngle = Math.atan2(dy, dx);
    }

    // Deliberately BEFORE super.update: a drawing archer is pinned in place, and this also has to
    // keep running while stunned, since a stun mustn't be able to cancel the cast.
    //
    // Only the draw roots it. Once the arrow is away the archer is free to move again — the
    // rooting exists to give the opponent a window to kill it in, and there's nothing left to
    // interrupt after release, so keeping it planted for the sun's whole 2.9s descent was just
    // handing out free damage for no design reason.
    if (this.ultPhase) {
      const rooted = this.ultPhase === "charge";
      // `movable = false` below is what actually pins it — its own vx/vy are deliberately left
      // alone. Zeroing them here as well looked equivalent and wasn't: nothing ever handed the
      // velocity back afterwards, so an Archer that had cast once stood motionless for the rest
      // of the round.
      this.updateUltimate(dt, opponent);
      const wasMovable = this.movable;
      if (rooted) this.movable = false; // base timers still run, movement doesn't
      super.update(dt, opponent);
      this.movable = wasMovable;
      return;
    }

    super.update(dt, opponent);
    if (this.stunTimer > 0) return;
    if (!this.canAttack) return;

    if (this.ultimateCooldown > 0) this.ultimateCooldown -= dt;
    // The ultimate takes priority over the ordinary shot: the moment it's up, everything stops
    if (this.ultimateCooldown <= 0 && opponent && opponent.alive) {
      this.beginUltimate();
      return;
    }

    this.charge = Math.min(ARCHER_CHARGE_TIME, this.charge + dt);

    // A full draw is the only thing that looses. Proximity deliberately does NOT rush the shot:
    // the whole shape of this character is one arrow every four seconds, no matter what.
    if (this.charge >= ARCHER_CHARGE_TIME && opponent && opponent.alive) this.loose(opponent);
  }

  beginUltimate() {
    this.ultPhase = "charge";
    this.ultTimer = 0;
    this.charge = 0;
    this.skyArrow = null;
    this.ultTarget = null;
    this.ultVictim = null;
    // Sunspots are rolled once per cast and then held, so the sun's face doesn't boil and
    // reshuffle every frame on the way down
    this.sunSpots = Array.from({ length: 7 }, () => ({
      a: Math.random() * Math.PI * 2,
      d: 0.15 + Math.random() * 0.6,
      r: 0.05 + Math.random() * 0.09,
      squash: 0.5 + Math.random() * 0.5,
      rot: Math.random() * Math.PI,
    }));
    // 4.989s long against a 5.0s draw — it runs out exactly as the arrow goes
    playSfx("archerUltCharge", 0.8);
  }

  updateUltimate(dt, opponent) {
    this.ultTimer += dt;

    // The sun keeps tracking whoever it was aimed at. The transfix should already be holding them
    // exactly where they were, so this is a belt-and-braces guarantee against anything else that
    // could still shift a stunned body — a shove, a grab, a knockback that lands on the same
    // frame. The one thing this ultimate must never do is come down next to the target.
    if (this.ultTarget && this.ultVictim && this.ultVictim.alive) {
      this.ultTarget.x = this.ultVictim.x;
      this.ultTarget.y = this.ultVictim.y;
    }

    if (this.ultPhase === "charge") {
      const f = this.ultTimer / ARCHER_ULT_CHARGE;
      // Building tremor through the draw
      if (f > 0.35) triggerShake(1.5 + f * 5, 0.1);
      if (this.ultTimer >= ARCHER_ULT_CHARGE) {
        // The target is locked HERE, at the moment of release. It's also pinned in place looking
        // up for the rest of the sequence — not just for the shot of it watching its own end, but
        // because a target that keeps walking leaves the sun landing on bare floor beside it,
        // which made the whole ultimate look like it had missed.
        if (opponent && opponent.alive) {
          this.ultTarget = { x: opponent.x, y: opponent.y };
          this.ultVictim = opponent;
          opponent.applyTransfix(ARCHER_ULT_ASCEND + ARCHER_ULT_HANG + ARCHER_ULT_DESCEND + 0.4);
        } else {
          this.ultTarget = { x: ARENA.x + ARENA.w / 2, y: ARENA.y + ARENA.h / 2 };
          this.ultVictim = null;
        }
        this.skyArrow = { x: this.x, y: this.y - this.size * 0.7 };
        this.ultPhase = "ascend";
        this.ultTimer = 0;
        triggerShake(14, 0.35);
        playSfx("archerBowShotSun", 0.95);
        spawnImpactParticles(this.x, this.y - this.size * 0.6, ["#ffffff", "#ffd23c", "#ff7a1a"], 40, 2.4, 0);
      }
      return;
    }

    if (this.ultPhase === "ascend") {
      if (this.skyArrow) {
        // Accelerating out of the top of the frame
        const f = this.ultTimer / ARCHER_ULT_ASCEND;
        this.skyArrow.y = (this.y - this.size * 0.7) - (f * f) * (this.y + 220);
      }
      if (this.ultTimer >= ARCHER_ULT_ASCEND) {
        this.skyArrow = null;
        this.ultPhase = "hang";
        this.ultTimer = 0;
      }
      return;
    }

    if (this.ultPhase === "hang") {
      if (this.ultTimer >= ARCHER_ULT_HANG) {
        this.ultPhase = "descend";
        this.ultTimer = 0;
        // The roar of the fall, deliberately kept underneath: archerSunCrash owns the landing
        // itself, and this clip's own peak (2.00s in, i.e. 0.3s past touchdown) would otherwise
        // fight it for the same moment instead of bedding in under it.
        playSfx("archerSundown", 0.5);
      }
      return;
    }

    if (this.ultPhase === "descend") {
      const f = this.ultTimer / ARCHER_ULT_DESCEND;
      triggerShake(4 + f * 22, 0.12);
      if (this.ultTimer >= ARCHER_ULT_DESCEND) {
        this.ultPhase = "crush";
        this.ultTimer = 0;
        triggerShake(34, 0.8);
        playSfx("archerSunCrash", 1.0);
        if (opponent && opponent.alive) {
          spawnImpactParticles(opponent.x, opponent.y, ["#ffffff", "#ffd23c", "#ff5a1a", "#8a2a00"], 90, 3.2, 0);
          spawnFlash(this.ultTarget.x, this.ultTarget.y, "#fff2c0", 460, 0.5);
          // Not damage — the sun simply ends the fight. Routed through takeDamage anyway so the
          // normal death path (onDeath, the fade, checkWinner) all runs exactly as usual.
          opponent.takeDamage(opponent.maxHp * 10);
        }
      }
      return;
    }

    if (this.ultPhase === "crush") {
      if (this.ultTimer >= ARCHER_ULT_CRUSH) {
        // The sun stays where it fell. The phase machine is done with it, but the star itself
        // doesn't get cleaned up — it sits on the arena for the rest of the round, so the thing
        // that ended the fight is still lying there while the win is being called.
        this.sunResting = { x: this.ultTarget.x, y: this.ultTarget.y + 8 };
        this.ultPhase = null;
        this.ultimateCooldown = ARCHER_ULT_COOLDOWN;
      }
    }
  }

  loose(opponent) {
    const angle = Math.atan2(opponent.y - this.y, opponent.x - this.x);
    // Leaves from the bow itself rather than the body's centre, so the arrow visibly continues
    // the line the drawn bow was already pointing along.
    const grip = this.bowGripOffset;
    const ox = this.x + Math.cos(angle) * grip;
    const oy = this.y + Math.sin(angle) * grip;
    this.arrows.push(new Arrow(ox, oy, angle));

    this.charge = 0;
    this.looseTimer = ARCHER_LOOSE_ANIM;
    spawnImpactParticles(ox, oy, ["#e8e0c0", "#8ee86a"], 6, 0.7, 0);
    playSfx("archerBow", 0.55);
  }

  get bowGripOffset() {
    return this.size / 2 + 10;
  }

  updateArrows(dt, opponent) {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.life -= dt;

      // At 2000px/sec an arrow covers 33px a frame — more than half a character's width — so
      // stepping it whole-frame would let it skip clean through a target between two frames.
      // Instead it's walked forward in sub-steps no longer than its own hit radius.
      const dist = ARCHER_ARROW_SPEED * dt;
      const steps = Math.max(1, Math.ceil(dist / ARCHER_ARROW_RADIUS));
      const sdt = dt / steps;
      let gone = false;

      for (let s = 0; s < steps && !gone; s++) {
        a.x += a.vx * sdt;
        a.y += a.vy * sdt;

        if (opponent && opponent.alive &&
            Math.hypot(opponent.x - a.x, opponent.y - a.y) <= opponent.size / 2 + ARCHER_ARROW_RADIUS) {
          opponent.takeDamage(ARCHER_DAMAGE);
          // Applied AFTER the damage, so an arrow never amplifies its own hit — the stack it
          // leaves behind is what makes the NEXT one land harder.
          opponent.applyBleed(1);
          spawnImpactParticles(a.x, a.y, ["#ffffff", "#c01d1d", "#8a5a2b"], 16, 1.3, 0);
          playSfx("archerBowHit", 0.7);
          gone = true;
          break;
        }

        // Stops at the wall's inner face with its own radius accounted for, rather than waiting
        // for its centre to leave the arena entirely.
        const left   = ARENA.x + ARENA_BORDER + ARCHER_ARROW_RADIUS;
        const right  = ARENA.x + ARENA.w - ARENA_BORDER - ARCHER_ARROW_RADIUS;
        const top    = ARENA.y + ARENA_BORDER + ARCHER_ARROW_RADIUS;
        const bottom = ARENA.y + ARENA.h - ARENA_BORDER - ARCHER_ARROW_RADIUS;
        if (a.x < left || a.x > right || a.y < top || a.y > bottom) {
          spawnImpactParticles(
            Math.min(right, Math.max(left, a.x)), Math.min(bottom, Math.max(top, a.y)),
            ["#cfc7a8", "#8a5a2b"], 8, 0.8, 0
          );
          gone = true;
        }
      }

      if (!gone && a.life <= 0) gone = true;
      if (gone) this.arrows.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- drawing
  //
  // Flat blocks of colour with a dark outline, and details clipped inside the body circle so they
  // never break the silhouette — the same way the rest of the cast is drawn. An earlier pass used
  // layered multi-stop gradients on the body, face, quiver and feather; it rendered fine on its
  // own but sat next to the other characters looking like it came out of a different game.

  draw(ctx) {
    this.drawArrowsInFlight(ctx);
    if (!this.alive && this.deathFadeTimer <= 0) return;
    this.drawChannelAura(ctx); // under the body, so the rings read as being on the floor
    super.draw(ctx);
  }

  drawArrowsInFlight(ctx) {
    for (const a of this.arrows) {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.angle);
      this.drawArrowShape(ctx, 26, 1);
      ctx.restore();
    }
  }

  // One arrow along +x with the head at the origin. Shared by the arrow in flight and the one
  // nocked on the string, so a shot looks like the same object leaving the bow.
  drawArrowShape(ctx, length, scale) {
    ctx.save();
    ctx.lineCap = "butt";

    // Shaft
    ctx.strokeStyle = "#c9a870";
    ctx.lineWidth = 3.2 * scale;
    ctx.beginPath();
    ctx.moveTo(-length, 0);
    ctx.lineTo(0, 0);
    ctx.stroke();

    // Fletching — two flat swept vanes at the tail
    ctx.fillStyle = "#8ee86a";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-length, 0);
      ctx.lineTo(-length + 9 * scale, s * 4.2 * scale);
      ctx.lineTo(-length + 3 * scale, s * 1.2 * scale);
      ctx.closePath();
      ctx.fill();
    }

    // Head — a flat bodkin point
    ctx.fillStyle = "#dcdce4";
    ctx.beginPath();
    ctx.moveTo(9 * scale, 0);
    ctx.lineTo(-1 * scale, -3.2 * scale);
    ctx.lineTo(-1 * scale, 3.2 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = ARCHER_OUTLINE;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  drawBody(ctx) {
    const r = this.size / 2;
    const t = performance.now() / 1000;
    const breathe = 1 + Math.sin(t * 1.5 + this.bodySeed) * 0.02;
    const flip = Math.cos(this.facingAngle) < 0 ? -1 : 1;

    ctx.save();
    ctx.translate(this.x, this.y);

    // Contact shadow, in unflipped space so it doesn't jump when the character turns
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.ellipse(0, r * 0.93, r * 0.72, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.scale(flip * breathe, breathe); // everything below is drawn facing right
    this.drawQuiver(ctx, r);
    this.drawTopknot(ctx, r, t);

    // Robe: one solid circle. A single gentle two-stop gradient is as far as the shading goes —
    // enough to stop it reading as a flat sticker, not enough to look moulded.
    const grad = ctx.createRadialGradient(-r * 0.28, -r * 0.32, r * 0.12, 0, 0, r * 1.02);
    grad.addColorStop(0, ARCHER_ROBE_LIGHT);
    grad.addColorStop(1, ARCHER_ROBE_DARK);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ARCHER_OUTLINE;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Everything from here is clipped to the body, so no detail can poke past the silhouette
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();

    // Hair framing the face, so the topknot above has something to grow out of
    ctx.fillStyle = ARCHER_HAIR;
    ctx.beginPath();
    ctx.ellipse(r * 0.04, -r * 0.3, r * 0.86, r * 0.66, 0, 0, Math.PI * 2);
    ctx.fill();

    // The face: one flat patch of skin. A full-width band (the trick the Ninja's mask uses) was
    // tried first and didn't survive the colour change — against near-black it reads as a mask,
    // but against a coloured robe it just looked like a bandage wrapped round the whole head.
    const fx = r * 0.2;
    ctx.fillStyle = ARCHER_SKIN;
    ctx.beginPath();
    ctx.ellipse(fx, r * 0.02, r * 0.44, r * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes: flat and dark, the forward one slightly larger so the head reads as turned. Kept big
    // and well apart — small dots close together in the middle of the patch turned the face into
    // a snout with two nostrils.
    const blink = Math.sin(t * 0.7 + this.bodySeed) > 0.985 ? 0.15 : 1;
    ctx.fillStyle = "#181818";
    for (const [ex, sc] of [[0.2, 1], [-0.14, 0.85]]) {
      ctx.beginPath();
      ctx.ellipse(fx + r * ex, r * 0.02, r * 0.1 * sc, r * 0.125 * sc * blink, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // A hard brow line over each eye — the scowl of someone who shoots suns out of the sky
    ctx.strokeStyle = "#181818";
    ctx.lineWidth = r * 0.055;
    ctx.lineCap = "round";
    for (const ex of [0.2, -0.14]) {
      ctx.beginPath();
      ctx.moveTo(fx + r * (ex - 0.11), -r * 0.12);
      ctx.lineTo(fx + r * (ex + 0.1), -r * 0.19);
      ctx.stroke();
    }

    // Gold circlet across the brow
    ctx.fillStyle = ARCHER_GOLD;
    ctx.fillRect(-r, -r * 0.58, r * 2, r * 0.15);
    ctx.fillStyle = ARCHER_GOLD_DK;
    ctx.fillRect(-r, -r * 0.44, r * 2, r * 0.05);
    // Its centre jewel, sitting over the forehead
    ctx.fillStyle = "#ffe9a0";
    ctx.beginPath();
    ctx.moveTo(r * 0.18, -r * 0.64);
    ctx.lineTo(r * 0.3, -r * 0.5);
    ctx.lineTo(r * 0.18, -r * 0.36);
    ctx.lineTo(r * 0.06, -r * 0.5);
    ctx.closePath();
    ctx.fill();

    // Gold collar at the base of the robe
    ctx.fillStyle = ARCHER_GOLD_DK;
    ctx.fillRect(-r, r * 0.52, r * 2, r * 0.16);
    ctx.fillStyle = ARCHER_GOLD;
    ctx.fillRect(-r, r * 0.52, r * 2, r * 0.07);

    ctx.restore(); // end clip
    ctx.restore();

    // Drawn outside the flip/breathe transform and in world space, since it has to line up
    // exactly with where loose() spawns the arrow.
    this.drawBow(ctx);
  }

  // The topknot, drawn before the body so it reads as sitting behind and above the head rather
  // than pasted on the front of it. Bun, binding ring, and the pin driven through it.
  drawTopknot(ctx, r, t) {
    const sway = Math.sin(t * 1.6 + this.bodySeed) * 0.06;
    ctx.save();
    ctx.translate(-r * 0.08, -r * 0.92);
    ctx.rotate(sway);

    ctx.fillStyle = ARCHER_HAIR;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.14, r * 0.3, r * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ARCHER_OUTLINE;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Gold ring binding the bun
    ctx.fillStyle = ARCHER_GOLD;
    ctx.fillRect(-r * 0.2, r * 0.04, r * 0.4, r * 0.1);
    ctx.fillStyle = ARCHER_GOLD_DK;
    ctx.fillRect(-r * 0.2, r * 0.11, r * 0.4, r * 0.03);

    // The pin driven through it
    ctx.strokeStyle = ARCHER_GOLD;
    ctx.lineWidth = r * 0.05;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-r * 0.36, -r * 0.28);
    ctx.lineTo(r * 0.34, -r * 0.04);
    ctx.stroke();
    ctx.restore();
  }

  // Quiver on the back — drawn before the body, so only its mouth and the fletchings clear the edge
  drawQuiver(ctx, r) {
    ctx.save();
    ctx.translate(-r * 0.72, r * 0.18);
    ctx.rotate(0.42);

    // Spare arrows standing in it
    for (const [off, len] of [[-0.15, 0.5], [0.0, 0.62], [0.15, 0.44]]) {
      ctx.strokeStyle = "#c9a870";
      ctx.lineWidth = r * 0.055;
      ctx.beginPath();
      ctx.moveTo(off * r, -r * 0.46);
      ctx.lineTo(off * r, -r * (0.46 + len));
      ctx.stroke();
      ctx.fillStyle = "#8ee86a";
      ctx.beginPath();
      ctx.moveTo(off * r, -r * (0.46 + len));
      ctx.lineTo(off * r - r * 0.1, -r * (0.28 + len));
      ctx.lineTo(off * r + r * 0.1, -r * (0.28 + len));
      ctx.closePath();
      ctx.fill();
    }

    // The tube: flat leather with a darker strap, plus the same outline the body gets
    ctx.fillStyle = ARCHER_LEATHER;
    ctx.beginPath();
    ctx.roundRect(-r * 0.26, -r * 0.5, r * 0.52, r * 1.15, r * 0.1);
    ctx.fill();
    ctx.strokeStyle = ARCHER_OUTLINE;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = ARCHER_LEATHER_DK;
    ctx.fillRect(-r * 0.26, -r * 0.2, r * 0.52, r * 0.12);
    ctx.fillRect(-r * 0.26, r * 0.32, r * 0.52, r * 0.12);
    ctx.restore();
  }

  // Mid-cast is the one thing worth calling out: those five seconds are the only window the
  // opponent ever gets, and the bar alone doesn't say that the sun is already coming.
  drawHud(ctx, x, y, w) {
    const ny = super.drawHud(ctx, x, y, w);
    if (this.ultPhase === "charge") {
      this.drawHudNote(ctx, x, ny, `SUN SHOT ${(ARCHER_ULT_CHARGE - this.ultTimer).toFixed(1)}s`, "#ffd23c");
    } else if (this.ultPhase) {
      this.drawHudNote(ctx, x, ny, "SUN SHOT — incoming", "#ff5a1a");
    }
  }

  // ---------------------------------------------------------------- Sun Shot overlay
  //
  // Drawn after BOTH fighters and every particle (see Character.drawOverlayEffects and main.js),
  // because a sun landing on someone has to be in front of them, not behind.

  drawOverlayEffects(ctx) {
    const t = performance.now() / 1000;

    // A landed sun outlives the ultimate's own state machine — it just sits there afterwards,
    // still churning, for the rest of the round.
    if (!this.ultPhase) {
      if (this.sunResting) this.drawSun(ctx, this.sunResting.x, this.sunResting.y, 260, t, 1);
      return;
    }

    this.drawSkyDim(ctx);
    if (this.ultPhase === "ascend" && this.skyArrow) this.drawSkyArrow(ctx);
    if (this.ultPhase === "hang") this.drawSkyTear(ctx);
    if (this.ultPhase === "descend" || this.ultPhase === "crush") this.drawFallingSun(ctx, t);
  }

  // The sky going out behind the whole thing. Ramps in over the draw, holds through the arrow and
  // the tear, then lifts again as the sun itself takes over the lighting.
  drawSkyDim(ctx) {
    let dim = 0;
    if (this.ultPhase === "charge") dim = (this.ultTimer / ARCHER_ULT_CHARGE) * 0.5;
    else if (this.ultPhase === "ascend") dim = 0.5 + (this.ultTimer / ARCHER_ULT_ASCEND) * 0.18;
    else if (this.ultPhase === "hang") dim = 0.68;
    else if (this.ultPhase === "descend") dim = 0.68 * (1 - this.ultTimer / ARCHER_ULT_DESCEND);
    if (dim <= 0.002) return;
    ctx.save();
    ctx.fillStyle = "rgba(6,2,14," + dim.toFixed(3) + ")";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.restore();
  }

  // The arrow climbing out of frame, trailing a hard beam of light
  drawSkyArrow(ctx) {
    const a = this.skyArrow;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // The beam it leaves behind, from the bow up to wherever it has got to
    const beam = ctx.createLinearGradient(a.x, this.y, a.x, a.y);
    beam.addColorStop(0, "rgba(255,190,60,0)");
    beam.addColorStop(0.5, "rgba(255,214,110,0.5)");
    beam.addColorStop(1, "rgba(255,255,230,0.9)");
    ctx.strokeStyle = beam;
    ctx.lineWidth = 9;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(a.x, a.y);
    ctx.stroke();

    // The head, with a bright cross-flare on it
    const g = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, 46);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.3, "rgba(255,214,110,0.6)");
    g.addColorStop(1, "rgba(255,120,20,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,240,0.85)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(a.x - 34, a.y); ctx.lineTo(a.x + 34, a.y);
    ctx.moveTo(a.x, a.y - 52); ctx.lineTo(a.x, a.y + 52);
    ctx.stroke();
    ctx.restore();
  }

  // The beat before the sun arrives: a split in the sky opening directly over the target, and a
  // pillar of light standing all the way down through it onto the ground it's about to land on.
  //
  // It runs the full height on purpose. An earlier version stopped at ARENA.y + 40 — a third of
  // the way down a 1280px canvas — which read as a beam that had been cut off in mid-air rather
  // than as light reaching the floor.
  drawSkyTear(ctx) {
    const f = this.ultTimer / ARCHER_ULT_HANG;
    const x = this.ultTarget.x;
    const floor = ARENA.y + ARENA.h - ARENA_BORDER;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    const w = 6 + f * 90;
    const across = ctx.createLinearGradient(x - w, 0, x + w, 0);
    across.addColorStop(0, "rgba(255,140,20,0)");
    across.addColorStop(0.5, "rgba(255,240,190," + (0.25 + f * 0.5).toFixed(3) + ")");
    across.addColorStop(1, "rgba(255,140,20,0)");
    ctx.fillStyle = across;
    ctx.fillRect(x - w, 0, w * 2, floor);

    // A second pass fading down the pillar's length, so it's brightest where it comes out of the
    // sky and softest where it meets the floor — without this the full-height version reads as a
    // flat rectangle laid over the arena.
    const down = ctx.createLinearGradient(0, 0, 0, floor);
    down.addColorStop(0, "rgba(255,246,214," + (0.3 * f).toFixed(3) + ")");
    down.addColorStop(0.45, "rgba(255,190,90," + (0.14 * f).toFixed(3) + ")");
    down.addColorStop(1, "rgba(255,140,20,0)");
    ctx.fillStyle = down;
    ctx.fillRect(x - w * 0.6, 0, w * 1.2, floor);

    // The pool of light it casts where it lands
    const pool = ctx.createRadialGradient(x, floor, 0, x, floor, w * 1.8);
    pool.addColorStop(0, "rgba(255,236,170," + (0.4 * f).toFixed(3) + ")");
    pool.addColorStop(1, "rgba(255,140,20,0)");
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.ellipse(x, floor, w * 1.8, w * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // The sun on its way down, and then sitting on what is left of the opponent
  drawFallingSun(ctx, t) {
    const target = this.ultTarget;
    let radius, cy, intensity;
    if (this.ultPhase === "descend") {
      const f = this.ultTimer / ARCHER_ULT_DESCEND;
      const e = f * f; // accelerating, so it reads as falling rather than being lowered
      radius = 70 + e * 190;
      cy = -260 + e * (target.y + 260);
      intensity = f;
    } else {
      radius = 260;
      cy = target.y + Math.min(1, this.ultTimer / 0.25) * 8; // settles as it crushes, then holds
      intensity = 1;
    }
    this.drawSun(ctx, target.x, cy, radius, t, intensity);
  }

  // The sun itself, built in layers from the outside in: corona, body with limb darkening,
  // granulation, sunspots, chromosphere rim, then prominences looping off the limb.
  drawSun(ctx, cx, cy, R, t, intensity) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // 1. Corona — the wide glow that lights the whole arena as it comes down
    const corona = ctx.createRadialGradient(cx, cy, R * 0.75, cx, cy, R * 3.1);
    corona.addColorStop(0, "rgba(255,180,60," + (0.5 * intensity).toFixed(3) + ")");
    corona.addColorStop(0.35, "rgba(255,110,20," + (0.2 * intensity).toFixed(3) + ")");
    corona.addColorStop(1, "rgba(120,20,0,0)");
    ctx.fillStyle = corona;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 3.1, 0, Math.PI * 2);
    ctx.fill();

    // Radiating shafts, turning slowly — keeps the corona from being a dead circle
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.11);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const len = R * (1.5 + Math.sin(t * 0.9 + i * 1.7) * 0.35);
      const shaft = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
      shaft.addColorStop(0, "rgba(255,190,80," + (0.16 * intensity).toFixed(3) + ")");
      shaft.addColorStop(1, "rgba(255,120,20,0)");
      ctx.strokeStyle = shaft;
      ctx.lineWidth = R * 0.12;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.restore();

    ctx.globalCompositeOperation = "source-over";

    // 2. Body, with limb darkening — the edge of a real star is cooler and dimmer than its middle,
    // and that one detail is most of what stops a yellow circle from looking like a sticker.
    const body = ctx.createRadialGradient(cx - R * 0.18, cy - R * 0.2, R * 0.05, cx, cy, R);
    body.addColorStop(0, "#fffdf0");
    body.addColorStop(0.3, "#ffe89a");
    body.addColorStop(0.58, "#ffb52e");
    body.addColorStop(0.82, "#f4661a");
    body.addColorStop(1, "#a82405");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    // Everything below sits on the disc only
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();

    // 3. Granulation, rotating slowly so the surface churns
    const tex = archerGetSunTexture();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.05);
    ctx.globalAlpha = 0.85;
    ctx.drawImage(tex, -R, -R, R * 2, R * 2);
    ctx.restore();

    // 4. Sunspots — a dark umbra with a warmer penumbra bleeding out of it
    if (this.sunSpots) {
      for (const sp of this.sunSpots) {
        const sx = cx + Math.cos(sp.a + t * 0.05) * sp.d * R;
        const sy = cy + Math.sin(sp.a + t * 0.05) * sp.d * R;
        const sr = sp.r * R;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(sp.rot);
        const spot = ctx.createRadialGradient(0, 0, 0, 0, 0, sr);
        spot.addColorStop(0, "rgba(70,14,0,0.85)");
        spot.addColorStop(0.55, "rgba(150,50,0,0.45)");
        spot.addColorStop(1, "rgba(200,90,0,0)");
        ctx.fillStyle = spot;
        ctx.beginPath();
        ctx.ellipse(0, 0, sr, sr * sp.squash, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // 5. Chromosphere: a hot rim hugging the inside of the limb
    ctx.globalCompositeOperation = "lighter";
    const rim = ctx.createRadialGradient(cx, cy, R * 0.86, cx, cy, R);
    rim.addColorStop(0, "rgba(255,120,20,0)");
    rim.addColorStop(0.75, "rgba(255,170,50,0.35)");
    rim.addColorStop(1, "rgba(255,230,150,0.75)");
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore(); // end disc clip

    // 6. Prominences — arcs of plasma looping off the limb, each anchored at two nearby points
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 6; i++) {
      const base = (i / 6) * Math.PI * 2 + t * 0.16;
      const spread = 0.2 + Math.sin(t * 1.1 + i) * 0.06;
      const h = R * (0.2 + 0.16 * (0.5 + 0.5 * Math.sin(t * 1.7 + i * 2.3)));
      const a1 = base - spread, a2 = base + spread;
      const p1x = cx + Math.cos(a1) * R * 0.97, p1y = cy + Math.sin(a1) * R * 0.97;
      const p2x = cx + Math.cos(a2) * R * 0.97, p2y = cy + Math.sin(a2) * R * 0.97;
      const apx = cx + Math.cos(base) * (R + h), apy = cy + Math.sin(base) * (R + h);
      ctx.strokeStyle = "rgba(255,120,30," + (0.5 * intensity).toFixed(3) + ")";
      ctx.lineWidth = R * 0.07;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(p1x, p1y);
      ctx.quadraticCurveTo(apx, apy, p2x, p2y);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,220,140," + (0.4 * intensity).toFixed(3) + ")";
      ctx.lineWidth = R * 0.025;
      ctx.stroke();
    }
    ctx.restore();
  }

  // The bow, and the whole reason to look at this character: how far through the four seconds it
  // is, is legible entirely from the bow's shape. At rest the string is nearly straight; as the
  // draw builds the limbs flex, the string hauls back, and the arrow's tail follows it.
  drawBow(ctx) {
    const r = this.size / 2;
    // During the ultimate the bow turns skyward and the draw is the ultimate's own, not the
    // ordinary shot's — the whole point of that phase is watching it haul back at the sky.
    const skyward = this.ultPhase === "charge" || this.ultPhase === "ascend";
    const draw = this.ultPhase === "charge" ? Math.min(1, this.ultTimer / ARCHER_ULT_CHARGE)
      : skyward ? 1
      : this.chargeRatio;
    const aim = skyward ? -Math.PI / 2 : this.facingAngle;
    // The bow arm punches forward on release, then settles back
    const kick = this.looseTimer > 0 ? (this.looseTimer / ARCHER_LOOSE_ANIM) * 0.22 : 0;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(aim);
    ctx.translate(this.bowGripOffset * (1 + kick), 0);
    // Local space from here: +x is downrange, the limbs run along +/-y.

    const tipY  = r * 0.95 * (1 - draw * 0.12); // limbs pull in as they flex
    const belly = r * (0.34 + draw * 0.2);      // ...and bow further forward
    const nockX = -r * (0.1 + draw * 0.62);     // how far back the string is hauled

    // Limbs — one flat stroke plus a lighter core, no gradient
    ctx.lineCap = "round";
    ctx.strokeStyle = ARCHER_LEATHER_DK;
    ctx.lineWidth = r * 0.13;
    ctx.beginPath();
    ctx.moveTo(0, -tipY);
    ctx.quadraticCurveTo(belly, 0, 0, tipY);
    ctx.stroke();
    ctx.strokeStyle = ARCHER_LEATHER;
    ctx.lineWidth = r * 0.06;
    ctx.beginPath();
    ctx.moveTo(0, -tipY * 0.95);
    ctx.quadraticCurveTo(belly * 0.98, 0, 0, tipY * 0.95);
    ctx.stroke();

    // Grip wrap at the riser
    ctx.strokeStyle = "#241505";
    ctx.lineWidth = r * 0.15;
    ctx.beginPath();
    ctx.moveTo(belly * 0.62, -r * 0.16);
    ctx.lineTo(belly * 0.62, r * 0.16);
    ctx.stroke();

    // String
    ctx.strokeStyle = `rgba(238,238,225,${(0.6 + draw * 0.4).toFixed(3)})`;
    ctx.lineWidth = Math.max(1, r * 0.035);
    ctx.beginPath();
    ctx.moveTo(0, -tipY);
    ctx.lineTo(nockX, 0);
    ctx.lineTo(0, tipY);
    ctx.stroke();

    // The nocked arrow. Its HEAD stays parked just in front of the bow and the tail follows the
    // string backwards, so the shaft visibly lengthens as the draw builds. A real arrow is of
    // course a fixed length — its head would travel back toward the riser instead — but drawn
    // that way round the low-draw pose is a long thin spike jutting far out past the bow, which
    // reads as a spear rather than a barely-drawn shot.
    const headX = belly + r * 0.4;
    ctx.save();
    ctx.translate(headX, 0);
    this.drawArrowShape(ctx, headX - nockX, 0.85);
    ctx.restore();

    // At a full draw the bow gets a rim of light — the "the shot is about to go" tell
    if (draw >= 0.999) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = "rgba(255,210,60,0.5)";
      ctx.lineWidth = r * 0.06;
      ctx.beginPath();
      ctx.moveTo(0, -tipY);
      ctx.quadraticCurveTo(belly, 0, 0, tipY);
      ctx.stroke();
      ctx.restore();
    }

    // The ultimate loads a visibly different arrow: the nocked shaft whites out and grows a
    // corona as the five seconds run down, so the difference between "about to take 15 damage"
    // and "about to lose the round" is legible from across the arena.
    if (this.ultPhase === "charge") {
      const f = Math.min(1, this.ultTimer / ARCHER_ULT_CHARGE);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const headX = belly + r * 0.4;
      const g = ctx.createRadialGradient(headX, 0, 0, headX, 0, r * (0.5 + f * 1.5));
      g.addColorStop(0, `rgba(255,255,255,${(0.55 + f * 0.45).toFixed(3)})`);
      g.addColorStop(0.35, `rgba(255,214,90,${(0.4 * f + 0.15).toFixed(3)})`);
      g.addColorStop(1, "rgba(255,110,20,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(headX, 0, r * (0.5 + f * 1.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  // Gathering rings while the ultimate channels, drawn around the archer's feet in world space.
  // Rings converge inward rather than expanding, which reads as power being pulled IN to the shot
  // instead of radiating out of it.
  drawChannelAura(ctx) {
    if (this.ultPhase !== "charge") return;
    const f = Math.min(1, this.ultTimer / ARCHER_ULT_CHARGE);
    const t = performance.now() / 1000;
    const r = this.size / 2;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) {
      const p = ((t * 0.75 + i / 3) % 1);
      const rad = r * (4.2 - p * 3.4);
      ctx.globalAlpha = (1 - Math.abs(p - 0.5) * 2) * 0.5 * f;
      ctx.strokeStyle = "#ffd23c";
      ctx.lineWidth = 2 + f * 3;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y + r * 0.6, rad, rad * 0.34, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // A column of light standing on the archer, growing through the draw
    ctx.globalAlpha = 1;
    const col = ctx.createLinearGradient(this.x, this.y, this.x, this.y - 260 * f);
    col.addColorStop(0, `rgba(255,200,70,${(0.3 * f).toFixed(3)})`);
    col.addColorStop(1, "rgba(255,140,20,0)");
    ctx.fillStyle = col;
    ctx.fillRect(this.x - r * 0.9, this.y - 260 * f, r * 1.8, 260 * f);
    ctx.restore();
  }
}
