// Base character class

const CHAR_BASE_SIZE = 60; // baseline size for a regular character
const HIT_FLASH_DURATION = 0.15;   // how long the white "flinch" flash lasts on a hit
const DEATH_FADE_DURATION = 0.5;   // how long the body takes to fade out after dying
const BIG_HIT_THRESHOLD = 20;      // damage at or above this gets an emphasized floating number
const ATTACK_GRACE_DURATION = 1.5; // seconds at round start where every character can move but not attack
const KNOCKBACK_DECAY_RATE = 2.5;  // how fast an external knockback/slow impulse fades back to nothing (per second)

// Bleed: a stacking vulnerability debuff, currently applied only by the Archer's arrows but
// implemented here on the base class because it has to amplify damage from EVERY source, not
// just from whoever applied it. Stacks share one timer that's refreshed in full by each new
// application, so keeping the stacks up means landing hits at least this often.
const BLEED_MAX_STACKS       = 5;
const BLEED_DAMAGE_PER_STACK = 0.1; // +10% damage taken per stack, so 5 stacks = +50%
const BLEED_DURATION         = 6.0;

class Character {
  constructor({ x, y, size = CHAR_BASE_SIZE, color = "#64c8ff", maxHp = 100, name = "Character", speed = 150 }) {
    this.x = x;
    this.y = y;
    this.size = size;
    this.baseSize = size;
    this.color = color;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.name = name;
    this.alive = true;

    // Wanders on its own: starts off in a random direction, bounces off walls
    this.speed = speed;
    const angle = Math.random() * Math.PI * 2;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.movable = true; // special states (e.g. Giant absorbing) can temporarily disable movement/knockback

    // Contact-damage invulnerability window, so one collision doesn't hit multiple frames in a row
    this.hitCooldown = 0;

    this.stunTimer = 0; // >0 while dazed: can't move or act
    this.hitFlashTimer = 0;  // >0 right after taking damage: flashes the body
    this.hitFlashColor = "#ffffff"; // white for an ordinary hit; takeDamage tints it per damage source
    this.deathFadeTimer = 0; // >0 right after dying: body fades out over this window
    this.attackGraceTimer = ATTACK_GRACE_DURATION; // >0 right after spawning: can move but not attack yet

    // A separate velocity layer for external impulses (knockback, or any future slow effect),
    // stacked on top of normal movement and never touching this.vx/vy directly — so it can
    // fade back to nothing on its own without fighting a character's own ability speeds
    // (e.g. the Giant's charge dash, which sets vx/vy directly and must stay exactly as set).
    this.knockbackVx = 0;
    this.knockbackVy = 0;

    this.bleedStacks = 0; // see applyBleed / bleedMultiplier
    this.bleedTimer = 0;  // one shared timer for the whole stack, refreshed by each application
    this.transfixedTimer = 0; // >0: rooted and staring upward, see applyTransfix
  }

  // Roots this character in place, staring up at whatever is about to happen to it. Mechanically
  // it's a stun — every character already bails out of its own update() on stunTimer, which is
  // exactly the "stop everything" behaviour wanted — but it's flagged separately so it reads as
  // dread rather than dizziness: the cartoon spiral is suppressed and the body leans back to look
  // up instead (see drawStunEffect / draw).
  applyTransfix(duration) {
    if (!this.alive) return;
    this.transfixedTimer = Math.max(this.transfixedTimer, duration);
    this.applyStun(duration);
  }

  // Adds bleed stacks and refreshes the whole stack's timer. Dead characters are left alone so a
  // killing blow can't leave a corpse visibly bleeding through its death fade.
  applyBleed(stacks = 1) {
    if (!this.alive) return;
    this.bleedStacks = Math.min(BLEED_MAX_STACKS, this.bleedStacks + stacks);
    this.bleedTimer = BLEED_DURATION;
  }

  // What all incoming damage gets multiplied by right now — see takeDamage.
  get bleedMultiplier() {
    return 1 + this.bleedStacks * BLEED_DAMAGE_PER_STACK;
  }

  // Applies an external velocity impulse (e.g. an explosion) that gradually fades back to
  // nothing on its own, instead of permanently altering the character's own velocity.
  // Respects the same fixed/immune rules as generic collision physics.
  applyKnockback(dirX, dirY, strength) {
    if (this.movable === false || this.knockbackImmune === true) return;
    this.knockbackVx += dirX * strength;
    this.knockbackVy += dirY * strength;
  }

  // True once the round-start grace period has elapsed. Subclasses should gate their
  // attack-triggering logic on this so nobody opens fire the instant a round begins.
  get canAttack() {
    return this.attackGraceTimer <= 0;
  }

  // Generic "ultimate" progress (0..1), used to draw one consistent second bar directly under
  // the HP bar in both the top HUD panel and the floating field bar. Characters with an
  // ultimate override this — during a special active state (absorbing, mounted, blitzing...)
  // it should still return a number (typically 1) rather than null, so the bar keeps showing
  // and any state text becomes extra info drawn below it, never a replacement for it.
  // Characters with nothing to show return null and no bar is drawn.
  get ultimateRatio() {
    return null;
  }

  get ultimateBarColor() {
    return "#64c8ff";
  }

  // True while this character should be untrackable by whoever it's fighting — main.js
  // substitutes null for the opponent reference passed into the OTHER fighter's update()
  // while this is true, so their aiming/targeting logic falls back to its own "no opponent"
  // behavior (every character already has one, for the dead-opponent case) instead of
  // chasing/shooting at something it shouldn't be able to perceive. This only blocks
  // deliberate targeting, not damage — an AOE or something it physically wanders into (e.g.
  // Bomber's blast radius) can still land a hit purely by proximity, same as if it could see.
  get isInvisibleToOpponents() {
    return false;
  }

  // True while this character shouldn't physically collide with OTHER characters at all (walls
  // still apply — that's handled separately, per-character, in moveAndBounce/whatever the
  // subclass does instead). main.js skips resolveCollision() between this character and anyone
  // else while this is true. Meant for genuinely non-solid states (e.g. Virus mid-swim, liquid
  // with nothing to bump into) where colliding would just mean getting shoved/stuck by whoever
  // it happens to overlap, not any real physical presence in the fight right now.
  get phasesThroughCharacters() {
    return false;
  }

  // True while this character has something in flight that still has to resolve before the round
  // can be called — main.js's checkWinner holds off entirely while either side reports true, the
  // same way it already waits out a pending self-destruct or live bombs. Meant for effects that
  // are committed the moment they're launched and shouldn't be cancellable by killing the caster
  // afterwards (Archer's Sun Shot, once the arrow is away). Default false.
  get blocksRoundEnd() {
    return false;
  }

  // Drawn right after the arena/wall-cracks but before EITHER fighter's own body — for anything
  // a character leaves sitting on the floor itself rather than carried on a character (e.g. Fire
  // Mage's lava patches), so both fighters visually stand on top of it instead of it painting
  // over them. Empty for every character that doesn't have any; see main.js's drawFrame.
  drawGroundEffects(ctx) {}

  // The mirror of drawGroundEffects — drawn after BOTH fighters and all the particles, for
  // anything a character puts over the whole scene while the round is still live (see Archer's
  // falling sun). Not the same thing as drawVictoryOverlay, which only runs once the round has
  // already been decided. Empty for every character that doesn't have one.
  drawOverlayEffects(ctx) {}

  // Extra fighter-owned bodies that should be just as targetable and collidable as this
  // character itself (e.g. the Ninja's shadow clone) — main.js folds these into both who the
  // opponent aims at (picking whichever of this character + its extra bodies is nearest) and
  // which collisions get resolved each frame. Empty for every character that doesn't have any.
  getExtraBodies() {
    return [];
  }

  // A real camera push a character can request during its own victory sequence — the whole
  // scene (arena, both fighters, particles, everything) scales together around {x, y}, by
  // {scale}, rather than just this character being drawn bigger and moved to screen center.
  // main.js applies this as a transform around the normal scene draw; null (the default) means
  // no character wants one right now. See Ninja's override for a concrete example.
  get victoryCameraZoom() {
    return null;
  }

  // The flat filled-bar-with-white-border shape every HP/charge/heat bar in the game uses,
  // factored out so the HUD panel and field bar don't each reimplement it.
  drawBar(ctx, x, y, w, h, ratio, color, lineWidth = 2) {
    ctx.fillStyle = "#1e1e23";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, ratio)), h);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(x, y, w, h);
  }

  // `colorOverride`: lets a damage-over-time source (Virus's Infection, Fire Mage's lava) tint
  // its own floating number differently from a normal hit, instead of always falling back to the
  // big-hit-red/white default — see spawnDamageNumber. It tints the body flash to match as well,
  // so an elemental burn reads as its own element (lava scalds orange-red, poison flashes purple)
  // rather than looking identical to a punch.
  takeDamage(dmg, colorOverride = null) {
    // Bleed scales EVERYTHING that lands, not just the arrows that applied it — the whole point
    // of the debuff is that a bleeding target is easier to kill by any means. Applied here at the
    // single choke point every damage source funnels through, so no attack can miss it.
    if (dmg > 0) dmg *= this.bleedMultiplier;

    if (dmg > 0) {
      this.hitFlashTimer = HIT_FLASH_DURATION;
      this.hitFlashColor = colorOverride || "#ffffff";
      spawnDamageNumber(this.x, this.y, dmg, dmg >= BIG_HIT_THRESHOLD, false, colorOverride);
    }

    const wasAlive = this.alive;
    this.hp = Math.max(0, this.hp - dmg);
    if (this.hp <= 0) this.alive = false;
    if (wasAlive && !this.alive) this.onDeath();
  }

  heal(amount) {
    if (amount <= 0 || !this.alive) return;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    const healed = this.hp - before;
    if (healed > 0) spawnDamageNumber(this.x, this.y, healed, false, true);
  }

  // Fired once, the instant HP hits 0. Kicks off the fade-out and a little farewell burst.
  onDeath() {
    this.deathFadeTimer = DEATH_FADE_DURATION;
    spawnImpactParticles(this.x, this.y, [this.color, "#ffffff", "#cccccc"], 40, 1.6, 100);
    spawnFlash(this.x, this.y, "#ffffff", 80, 0.4);
    triggerShake(10, 0.3);
  }

  // Knocks this character senseless for `duration` seconds: frozen in place and immune
  // to further knockback until it wears off.
  applyStun(duration) {
    this.stunTimer = Math.max(this.stunTimer, duration);
    this.vx = 0;
    this.vy = 0;
    this.movable = false;
  }

  // Called once stunTimer runs out; subclasses can override for anything extra.
  onStunEnd() {
    this.movable = true;
    const angle = Math.random() * Math.PI * 2;
    this.vx = Math.cos(angle) * this.speed;
    this.vy = Math.sin(angle) * this.speed;
  }

  moveAndBounce(dt) {
    // The knockback layer decays back toward zero on its own each frame, so a burst of extra
    // speed from an explosion gradually settles back to the character's normal pace.
    const decay = Math.min(1, KNOCKBACK_DECAY_RATE * dt);
    this.knockbackVx -= this.knockbackVx * decay;
    this.knockbackVy -= this.knockbackVy * decay;

    this.x += (this.vx + this.knockbackVx) * dt;
    this.y += (this.vy + this.knockbackVy) * dt;

    const half   = this.size / 2;
    const left   = ARENA.x + ARENA_BORDER + half;
    const right  = ARENA.x + ARENA.w - ARENA_BORDER - half;
    const top    = ARENA.y + ARENA_BORDER + half;
    const bottom = ARENA.y + ARENA.h - ARENA_BORDER - half;

    let bounced = false;
    if (this.x < left)   { this.x = left;   this.vx = Math.abs(this.vx);  this.knockbackVx = Math.abs(this.knockbackVx);  bounced = true; }
    if (this.x > right)  { this.x = right;  this.vx = -Math.abs(this.vx); this.knockbackVx = -Math.abs(this.knockbackVx); bounced = true; }
    if (this.y < top)    { this.y = top;    this.vy = Math.abs(this.vy);  this.knockbackVy = Math.abs(this.knockbackVy);  bounced = true; }
    if (this.y > bottom) { this.y = bottom; this.vy = -Math.abs(this.vy); this.knockbackVy = -Math.abs(this.knockbackVy); bounced = true; }

    if (bounced) playSfx("wallHit", 0.35);
    return bounced;
  }

  update(dt, opponent) {
    if (this.deathFadeTimer > 0) this.deathFadeTimer -= dt; // keeps fading even though dead
    if (!this.alive) return;
    if (this.hitFlashTimer > 0) this.hitFlashTimer -= dt;
    if (this.attackGraceTimer > 0) this.attackGraceTimer -= dt;
    if (this.bleedTimer > 0) {
      this.bleedTimer -= dt;
      if (this.bleedTimer <= 0) this.bleedStacks = 0; // the whole stack drops at once, not one at a time
    }
    if (this.transfixedTimer > 0) this.transfixedTimer -= dt;
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      if (this.stunTimer <= 0) this.onStunEnd();
      return;
    }
    if (this.movable) this.moveAndBounce(dt);
    if (this.hitCooldown > 0) this.hitCooldown -= dt;
  }

  draw(ctx) {
    if (!this.alive && this.deathFadeTimer <= 0) return;

    const alpha = this.alive ? 1 : Math.max(0, this.deathFadeTimer / DEATH_FADE_DURATION);
    ctx.save();
    ctx.globalAlpha = alpha;
    // Leaning back to look up. Applied around the whole body rather than inside any one
    // character's drawBody, so it works for every character without touching any of them —
    // they all draw around their own x/y, so rotating about a point below their feet tips the
    // whole figure back as one piece.
    if (this.transfixedTimer > 0) {
      const lean = -0.3 * Math.min(1, this.transfixedTimer * 4); // eases out as it wears off
      const pivotY = this.y + this.size * 0.5;
      ctx.translate(this.x, pivotY);
      ctx.rotate(lean);
      ctx.translate(-this.x, -pivotY);
    }
    this.drawBody(ctx);
    if (this.hitFlashTimer > 0) {
      const savedColor = this.color;
      this.color = this.hitFlashColor || "#ffffff";
      ctx.globalAlpha = alpha * Math.min(1, this.hitFlashTimer / HIT_FLASH_DURATION) * 0.75;
      this.drawBody(ctx);
      this.color = savedColor;
    }
    ctx.restore();

    if (this.alive) {
      this.drawBleedEffect(ctx);
      this.drawFieldHpBar(ctx);
      this.drawStunEffect(ctx);
    }
  }

  // Bleed, shown as drops running down the body — one per stack, so how badly a target is
  // bleeding is readable off the character itself rather than only off a number somewhere.
  // Each drop falls on its own loop and restarts at the top, at a rate that climbs with the
  // stack count, so five stacks visibly pours where one just trickles.
  drawBleedEffect(ctx) {
    if (this.bleedStacks <= 0) return;
    const r = this.size / 2;
    const t = performance.now() / 1000;
    // Fades out over the last second of the debuff, so it stops rather than vanishing mid-flow
    const alpha = Math.min(1, this.bleedTimer) * 0.9;

    ctx.save();
    ctx.translate(this.x, this.y);
    for (let i = 0; i < this.bleedStacks; i++) {
      // Spread across the lower half of the body, evenly regardless of how many there are
      const a = -Math.PI * 0.42 + (Math.PI * 0.84) * ((i + 0.5) / this.bleedStacks);
      const ox = Math.sin(a) * r * 0.78;
      const fall = ((t * (0.7 + this.bleedStacks * 0.12) + i * 0.37) % 1);
      const oy = -r * 0.1 + fall * r * 1.05;
      const fade = Math.sin(fall * Math.PI); // fades in at the top, out at the bottom
      ctx.globalAlpha = alpha * fade;
      ctx.fillStyle = "#c01d1d";
      ctx.beginPath();
      // A teardrop: round belly, pointed top
      ctx.moveTo(ox, oy - r * 0.13);
      ctx.quadraticCurveTo(ox + r * 0.07, oy, ox, oy + r * 0.07);
      ctx.quadraticCurveTo(ox - r * 0.07, oy, ox, oy - r * 0.13);
      ctx.fill();
    }
    ctx.restore();
  }

  // Shared "dizzy" indicator: a small purple spiral that spins above a stunned
  // character's head, like a classic cartoon dazed effect.
  drawStunEffect(ctx) {
    if (this.stunTimer <= 0) return;
    // Transfixed characters are stunned under the hood, but the dizzy spiral would read as a
    // gag exactly when the moment wants to be ominous — the lean-back in draw() carries it
    // instead. See applyTransfix.
    if (this.transfixedTimer > 0) return;

    const cx = this.x;
    const cy = this.y - this.size / 2 - 30;
    const t = performance.now() / 1000;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = "#c060ff";
    ctx.lineWidth = 3.5;
    ctx.shadowColor = "#c060ff";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    const turns = 2.2;
    const maxAngle = turns * Math.PI * 2;
    const maxRadius = 22;
    for (let a = 0; a <= maxAngle; a += 0.25) {
      const r = (a / maxAngle) * maxRadius;
      const angle = a + t * 4;
      const px = Math.cos(angle) * r;
      const py = Math.sin(angle) * r * 0.6;
      if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Default shape is a square; subclasses can override with something else
  drawBody(ctx) {
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x - this.size / 2, this.y - this.size / 2, this.size, this.size);
  }

  // One short line of state under the bars, for the single thing about this character the bars
  // themselves can't say. Deliberately capped at one line each: the per-character cooldown
  // readouts that used to live here stacked up into a wall of text nobody read. A character with
  // nothing notable happening passes null and draws nothing at all.
  drawHudNote(ctx, x, y, text, color = "rgba(255,255,255,0.62)") {
    if (!text) return;
    ctx.textAlign = "left";
    ctx.fillStyle = color;
    ctx.font = "13px Arial";
    ctx.fillText(text, x, y);
  }

  // HP bar floats above the character's head for a quick read during combat. Directly under
  // it, a slimmer ultimate-progress bar for anyone that has one (see ultimateRatio).
  drawFieldHpBar(ctx) {
    const barW = Math.max(70, this.size * 0.9);
    const barX = this.x - barW / 2;
    const barY = this.y - this.size / 2 - 22;
    const ratio = Math.max(0, this.hp / this.maxHp);

    this.drawBar(ctx, barX, barY, barW, 10, ratio, ratio > 0.5 ? "#50f050" : ratio > 0.3 ? "#ffc832" : "#ff3c3c");

    ctx.fillStyle = "#ffffff";
    ctx.font = "12px Arial";
    ctx.textAlign = "center";
    ctx.fillText(`${Math.ceil(this.hp)}/${this.maxHp}`, this.x, barY - 4);

    const ultRatio = this.ultimateRatio;
    if (ultRatio !== null) {
      this.drawBar(ctx, barX, barY + 10 + 4, barW, 6, ultRatio, this.ultimateBarColor, 1);
    }
  }

  // Top HUD panel. Fixed vertical order, regardless of character state: name, then HP bar,
  // then — if this character has one — the ultimate bar directly under it. Subclasses stack
  // whatever extra info/state text they want below the y this returns; that text can never
  // take the bar's place, only add to what's below it.
  drawHud(ctx, x, y, w) {
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = hudNameFont();
    ctx.fillText(this.alive ? this.name : `${this.name} (Defeated)`, x, y);

    const barH = 18;
    const barY = y + 14;
    const ratio = Math.max(0, this.hp / this.maxHp);
    this.drawBar(ctx, x, barY, w, barH, ratio, ratio > 0.5 ? "#50f050" : ratio > 0.3 ? "#ffc832" : "#ff3c3c");

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "13px Arial";
    ctx.textAlign = "right";
    ctx.fillText(`${Math.ceil(this.hp)}/${this.maxHp}`, x + w, barY - 4);
    ctx.textAlign = "left";

    let ny = barY + barH + 14;

    const ultRatio = this.ultimateRatio;
    if (ultRatio !== null) {
      const ultBarH = 10;
      const ultBarY = ny - 10;
      this.drawBar(ctx, x, ultBarY, w, ultBarH, ultRatio, this.ultimateBarColor, 1);
      ny = ultBarY + ultBarH + 16;
    }

    return ny;
  }
}
