// Base character class

const CHAR_BASE_SIZE = 60; // baseline size for a regular character
const HIT_FLASH_DURATION = 0.15;   // how long the white "flinch" flash lasts on a hit
const DEATH_FADE_DURATION = 0.5;   // how long the body takes to fade out after dying
const BIG_HIT_THRESHOLD = 20;      // damage at or above this gets an emphasized floating number
const ATTACK_GRACE_DURATION = 1.5; // seconds at round start where every character can move but not attack
const KNOCKBACK_DECAY_RATE = 2.5;  // how fast an external knockback/slow impulse fades back to nothing (per second)

// How long a character takes to work its OWN speed back to where it belongs after something
// outside it has changed the magnitude — overwhelmingly resolveCollision, which swaps the two
// velocities outright, so a 150-speed character that bumps a 400-speed one walks away at 400 and
// the fast one crawls at 150 for the rest of the round. Nothing put it back before this.
//
// The bound has to hold for ANY size of error, not just small ones. A Giant that lets go of its
// charge leaves the target at 900; at a flat `speed / 1.25` that would take 3.25s to shed. So the
// correction is exponential — which clears a proportional share of whatever the error is — with a
// constant floor underneath it so the last sliver still lands instead of asymptoting. Together,
// any error at all is gone in about SPEED_RESTORE_SECONDS. See restoreOwnSpeed.
//
// Direction is never touched, only the magnitude, so a knockback that has turned someone around
// still carries them where it threw them.
const SPEED_RESTORE_SECONDS = 1.25;
// A knockback at or above this also turns the character to face the way it is being thrown. Set
// so the deliberate little nudges stay nudges — a Demon trident is 70 and the Gunner's own rocket
// recoil is 200 — while anything that reads as an actual launch (Bomber 500-700, Punch Man (New)
// 950, Fire Mage and Troll 1500) reorients. Impulses are scaled down against bigger targets
// before they get here, which is the behaviour you want: a shove that barely moves a Giant
// shouldn't spin it around either.
const KNOCKBACK_TURN_MIN = 400;
const SPEED_RESTORE_DECAY   = 5 / SPEED_RESTORE_SECONDS; // e^-5 of the error left after 1.25s

// Bleed: a stacking vulnerability debuff, currently applied only by the Archer's arrows but
// implemented here on the base class because it has to amplify damage from EVERY source, not
// just from whoever applied it. Stacks share one timer that's refreshed in full by each new
// application, so keeping the stacks up means landing hits at least this often.
const BLEED_MAX_STACKS       = 5;
const BLEED_DAMAGE_PER_STACK = 0.1; // +10% damage taken per stack, so 5 stacks = +50%
const BLEED_DURATION         = 6.0;

class Character {
  constructor({ x, y, size = CHAR_BASE_SIZE, color = "#64c8ff", maxHp = 100, name = "Character",
                nameZh = null, speed = 150 }) {
    this.x = x;
    this.y = y;
    this.size = size;
    this.baseSize = size;
    this.color = color;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.name = name;
    // Shown instead of `name` on the Twitch overlay only — see L() in arena.js. Left null by
    // anything that has no translation (the lab dummy, the Ninja's clones), which falls back.
    this.nameZh = nameZh;
    this.alive = true;

    // Wanders on its own: starts off in a random direction, bounces off walls
    this.speed = speed;
    const angle = Math.random() * Math.PI * 2;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.movable = true; // special states (e.g. Giant absorbing) can temporarily disable movement/knockback
    this.pinnedTimer = 0; // >0: held in place but still able to act — see applyPin
    this.slowTimer = 0;   // >0: moving at slowMul of its normal pace — see applySlow
    this.slowMul = 1;

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
    this.deafenedTimer = 0;   // >0: rooted with its ears blown out, see applyDeafen
    this.deafenedMax = 0;     // the duration the current deafen started at, so the fx can fade
  }

  // Roots this character in place, staring up at whatever is about to happen to it. Mechanically
  // it's a stun — every character already bails out of its own update() on stunTimer, which is
  // exactly the "stop everything" behaviour wanted — but it's flagged separately so it reads as
  // dread rather than dizziness: the cartoon spiral is suppressed and the body leans back to look
  // up instead (see drawStunEffect / draw).
  applyTransfix(duration) {
    if (!this.alive || this.immuneToControl) return;
    this.transfixedTimer = Math.max(this.transfixedTimer, duration);
    this.applyStun(duration);
  }

  // Blown eardrums: rooted and unable to act. Mechanically a stun for the same reason
  // applyTransfix is one — every character already bails out of its own update() on stunTimer,
  // which is exactly the "stop everything" behaviour wanted — but flagged separately so it reads
  // as a burst eardrum rather than dizziness. The cartoon spiral is suppressed (see
  // drawStunEffect), the body picks up a fast tremor (see draw), and drawDeafenEffect draws the
  // ringing and the bleeding ears.
  applyDeafen(duration) {
    if (!this.alive || this.immuneToControl) return;
    this.deafenedTimer = Math.max(this.deafenedTimer, duration);
    this.deafenedMax = Math.max(this.deafenedMax, this.deafenedTimer);
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

  // True while this character shrugs off every form of crowd control — stuns, pins, deafens,
  // transfixes alike. Default false; overridden by states that are supposed to be unstoppable
  // once committed (the Giant's charge).
  //
  // Checked at the point each effect is APPLIED, so an effect that would have landed simply
  // never starts. It deliberately does not clear anything already running — a state that wants
  // that does it itself when it begins (see Giant.launchCharge).
  get immuneToControl() {
    return false;
  }

  // Held in place, but NOT dazed: a pinned character can still attack, aim and act — the only
  // thing it loses is the ability to move itself off the spot. Deliberately distinct from
  // applyStun (which stops everything) and from applyDeafen/applyTransfix (which are stuns
  // wearing a different costume). The Earth Mage's sand is the first thing to use it.
  //
  // Knockback is suppressed for the duration too, which falls out of `movable` and is what the
  // effect wants anyway: something pinned to the ground shouldn't slide when hit.
  applyPin(duration) {
    if (!this.alive || this.immuneToControl) return;
    this.pinnedTimer = Math.max(this.pinnedTimer, duration);
  }

  // Wading. The first debuff in the game that neither stops a character nor stops it acting: it
  // only makes it slower, which is the whole identity of the character that inflicts it.
  //
  // `mul` is a fraction of normal pace (0.4 = 40%). Stacking takes the HARSHEST multiplier and
  // the LONGEST remaining time rather than adding, so standing in a puddle while being shot does
  // not compound into a full stop — this is meant to be inconvenient, not another stun.
  //
  // Applied to the current velocity immediately so it bites on the frame it lands; restoreSpeed
  // below then holds it down, and lets it climb back over SPEED_RESTORE_SECONDS once the timer
  // runs out, which reads as pulling free of the muck rather than a switch flipping.
  applySlow(mul, duration) {
    if (!this.alive || this.immuneToControl) return;
    const m = Math.max(0.05, Math.min(1, mul));
    if (this.slowTimer <= 0 || m < this.slowMul) {
      // Only scale the live velocity when this makes it slower than it already was, or the same
      // aura re-applying every frame would grind it to a halt.
      const mag = Math.hypot(this.vx, this.vy);
      const target = this.speed * m;
      if (mag > target && mag > 0.01) {
        this.vx *= target / mag;
        this.vy *= target / mag;
      }
    }
    this.slowMul = this.slowTimer > 0 ? Math.min(this.slowMul, m) : m;
    this.slowTimer = Math.max(this.slowTimer, duration);
  }

  // 1 when not slowed. Read by restoreSpeed, so every character inherits the effect without
  // knowing about it — including the two that manage their own speed (the Knight's charge ramp
  // writes this.speed, the Troll computes it from its own state; both are multiplied here).
  get slowFactor() {
    return this.slowTimer > 0 ? this.slowMul : 1;
  }

  // `movable` is a getter over a plain backing field rather than a plain property, so a pin can
  // veto movement without fighting every `this.movable = x` assignment already scattered through
  // the cast (applyStun/onStunEnd, the Giant's absorb window, and so on) — those all still write
  // straight through the setter exactly as before.
  get movable() {
    return this._movable !== false && this.pinnedTimer <= 0;
  }
  set movable(v) { this._movable = v; }

  // Applies an external velocity impulse (e.g. an explosion) that gradually fades back to
  // nothing on its own, instead of permanently altering the character's own velocity.
  // Respects the same fixed/immune rules as generic collision physics.
  applyKnockback(dirX, dirY, strength) {
    if (this.movable === false || this.knockbackImmune === true) return;
    this.knockbackVx += dirX * strength;
    this.knockbackVy += dirY * strength;

    // Being launched also turns the character to head the way it was thrown, keeping its own
    // speed — only the direction changes.
    //
    // Without this the knockback layer carries it one way while vx/vy still point wherever it
    // happened to be walking, so the moment the impulse decays (KNOCKBACK_DECAY_RATE, well under
    // a second) it turns straight round and walks back into whatever just hit it. That is the
    // "doesn't look like it got knocked back" case: the launch itself was fine, the recovery was
    // wrong.
    //
    // Taken off the ACCUMULATED knockback rather than this one impulse, so two shoves landing
    // together send it where their sum actually points.
    const kb = Math.hypot(this.knockbackVx, this.knockbackVy);
    if (kb < KNOCKBACK_TURN_MIN) return;
    // A character driving its own velocity on purpose is not steered off its line — the same set
    // restoreSpeed marks null: a Giant mid-charge, Punch Man (New) mid-dash, the Troll leaning
    // into a swing.
    if (this.restoreSpeed == null) return;
    const own = Math.hypot(this.vx, this.vy);
    if (own < 0.01) return;   // deliberately standing still; nothing to redirect
    this.vx = (this.knockbackVx / kb) * own;
    this.vy = (this.knockbackVy / kb) * own;
  }

  // True once the round-start grace period has elapsed. Subclasses should gate their
  // attack-triggering logic on this so nobody opens fire the instant a round begins.
  // The name as it should appear on screen right now. Everything that draws a character's name
  // goes through this rather than reading `name` directly, which stays the stable internal one.
  get displayName() {
    return (arenaLayout === "twitch" && this.nameZh) ? this.nameZh : this.name;
  }

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

  // True while this character has something that still has to resolve before the round can be
  // called — main.js's checkWinner holds off entirely while either side reports true, the same
  // way it already waits out a pending self-destruct or live bombs. Covers two different things:
  //
  //  - a COMMITTED in-flight effect that shouldn't be cancellable by killing whoever launched it
  //    (Archer's Sun Shot, once the arrow is away — see the override there);
  //  - this character itself still visibly held by crowd control. A stun/pin animation still
  //    playing when the KO screen pops up over it reads as the round being called out from under
  //    something that clearly is not finished yet.
  //
  // The CC half only checks `this.alive` — a fighter that died mid-stun has no ticking timer
  // left to clear (update() bails out the instant !alive), so a dead body's stale stunTimer would
  // hold the round open forever if that guard were missing.
  //
  // Subclasses with their own in-flight effects to add (Archer, the Earth Mage) combine it via
  // `super.blocksRoundEnd ||`, not replace it outright.
  get blocksRoundEnd() {
    return this.alive && (this.stunTimer > 0 || this.pinnedTimer > 0);
  }

  // Drawn right after the arena/wall-cracks but before EITHER fighter's own body — for anything
  // a character leaves sitting on the floor itself rather than carried on a character (e.g. Fire
  // Mage's lava patches), so both fighters visually stand on top of it instead of it painting
  // over them. Empty for every character that doesn't have any; see main.js's drawFrame.
  drawGroundEffects(ctx) {}

  // Upright props this character owns that stand on the arena floor as separate objects from its
  // own body — a Bomber's planted bombs, an Earth Mage's stone pillars.
  //
  // These have to sort into the SAME depth pass as the fighters, individually. Drawing them
  // inside the owner's own draw() (which is what Bomber did with its bombs) pins every one of
  // them to the OWNER's depth, so a bomb planted well in front of the Bomber still rendered at
  // the Bomber's place in the stack. Returning them here lets each one take its own slot.
  //
  // `depthY` is the y the prop should sort AT — normally where it meets the floor. Flat floor
  // decals (lava, scorch marks, pillar sockets) do NOT belong here: those are painted on the
  // ground and correctly belong under everything, which is what drawGroundEffects is for.
  getDepthItems() {
    return [];
  }

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

  // A temporary shield, in points of damage it will absorb before the health under it is touched.
  // 0 for every character that has none — the Angel's rite is currently the only source. Drawn as
  // a white band sitting ON TOP of the health bar, starting where the health ends, so the two read
  // as one pool with a bright cap rather than as a second bar to keep track of.
  get shieldPoints() {
    return 0;
  }

  drawShieldBand(ctx, x, y, w, h) {
    const sp = this.shieldPoints;
    if (sp <= 0) return;
    // Overlaid on the RIGHT END of the bar, on top of whatever health is there.
    //
    // The first version appended it after the health instead, which meant a character at full HP
    // had no room left and its shield simply did not render — exactly the case that matters most,
    // since the Angel is usually unhurt when its own rite wards it. Overlaying always shows, and
    // reads correctly either way: this much of the next hit is eaten before the bar moves.
    const shFrac = Math.min(1, sp / this.maxHp);
    const hpFrac = 1 - shFrac;
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + w * hpFrac, y, w * shFrac, h);
    ctx.strokeStyle = "rgba(190,214,255,0.9)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + w * hpFrac, y, w * shFrac, h);
    ctx.restore();
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
    if (this.immuneToControl) return;
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

  // The speed this character's own vx/vy should settle back to, or null to leave it alone for
  // now. Overridden by the characters that drive their own velocity deliberately — a Giant
  // mid-charge, Punch Man (New) mid-dash, the Troll leaning into a swing — so the restore never
  // fights a state that means to be moving at some other pace.
  //
  // The Knight needs no override despite being the one character that changes speed on its own:
  // its ramp already rescales vx/vy to this.speed every frame and runs BEFORE super.update(), so
  // by the time this sees it there is nothing left to correct. Its recovery stays instant, and
  // this.speed follows the ramp, so the target is always the right one.
  get restoreSpeed() {
    return this.speed * this.slowFactor;
  }

  restoreOwnSpeed(dt) {
    const target = this.restoreSpeed;
    if (target == null || target <= 0) return;
    const mag = Math.hypot(this.vx, this.vy);
    // A character that has deliberately stopped — casting, absorbing, planted mid-swing — has no
    // direction to restore along, and must not be shoved back up to walking pace.
    if (mag < 0.01) return;
    const diff = target - mag;
    if (Math.abs(diff) < 0.5) return;
    const step = Math.max(Math.abs(diff) * SPEED_RESTORE_DECAY,
                          target / SPEED_RESTORE_SECONDS) * dt;
    const next = mag + (diff > 0 ? Math.min(diff, step) : Math.max(diff, -step));
    this.vx *= next / mag;
    this.vy *= next / mag;
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
    if (this.deafenedTimer > 0) {
      this.deafenedTimer -= dt;
      if (this.deafenedTimer <= 0) this.deafenedMax = 0;
    }
    if (this.pinnedTimer > 0) this.pinnedTimer -= dt;
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) this.slowMul = 1;
    }
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      if (this.stunTimer <= 0) this.onStunEnd();
      return;
    }
    if (this.movable) {
      this.restoreOwnSpeed(dt);
      this.moveAndBounce(dt);
    }
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
    // Deafened: a fast, small tremor — the world ringing. Deliberately high frequency and only a
    // couple of pixels, so it reads as the character's own disorientation and not as a second
    // screen shake. Same "applies to every character without touching any of them" trick as the
    // transfix lean above.
    if (this.deafenedTimer > 0) {
      const f = Math.min(1, this.deafenedTimer / (this.deafenedMax || 1));
      const tm = performance.now() / 1000;
      ctx.translate(Math.sin(tm * 61) * 2.6 * f, Math.cos(tm * 47) * 1.9 * f);
    }
    this.drawBody(ctx);
    if (this.hitFlashTimer > 0) {
      this.drawHitFlash(ctx, alpha * Math.min(1, this.hitFlashTimer / HIT_FLASH_DURATION) * 0.75);
    }
    ctx.restore();

    if (this.alive) {
      this.drawBleedEffect(ctx);
      this.drawFieldHpBar(ctx);
      this.drawStunEffect(ctx);
      this.drawDeafenEffect(ctx);
      this.drawPinEffect(ctx);
    }
  }

  // The flash on taking a hit. The default re-draws the body with this.color swapped for the
  // flash colour, which whitens every character whose body fill IS this.color.
  //
  // A character that paints itself from its own fixed palette must override this. Re-drawing it
  // unchanged at partial alpha does not whiten anything — it just lays the same figure over
  // itself, which reads as the character briefly going see-through instead of flashing. See
  // Troll.drawHitFlash.
  drawHitFlash(ctx, strength) {
    const savedColor = this.color;
    this.color = this.hitFlashColor || "#ffffff";
    ctx.globalAlpha = strength;
    this.drawBody(ctx);
    this.color = savedColor;
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
    // Same reasoning for a deafened character: the spiral says "dizzy", and this wants to say
    // "its ears just went". See applyDeafen / drawDeafenEffect.
    if (this.deafenedTimer > 0) return;

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

  // Blown eardrums, drawn as three things at once so it can't be mistaken for the stun spiral:
  // rings collapsing INWARD onto the head (the exact inverse of the roar's outgoing rings, so the
  // two read as cause and effect), a jagged white burst off each ear, and blood running down from
  // them. The body's own tremor is applied back in draw().
  drawDeafenEffect(ctx) {
    if (this.deafenedTimer <= 0) return;
    const max = this.deafenedMax || 1;
    const f = Math.max(0, Math.min(1, this.deafenedTimer / max)); // 1 fresh, 0 as it wears off
    const t = performance.now() / 1000;
    const r = this.size / 2;
    const headY = this.y - r * 0.16;

    ctx.save();

    // Sound crushing in
    for (let i = 0; i < 3; i++) {
      const p = (t * 2.4 + i / 3) % 1;
      const rad = r * (2.2 - p * 1.25);
      ctx.globalAlpha = (1 - p) * 0.55 * f;
      ctx.strokeStyle = "#fff2f2";
      ctx.lineWidth = 1.5 + (1 - p) * 2.5;
      ctx.beginPath();
      ctx.ellipse(this.x, headY, rad, rad * 0.74, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const side of [1, -1]) {
      const ex = this.x + side * r * 0.86;
      const ey = headY - r * 0.06;

      // The burst: short jagged spikes off the ear, flickering at high frequency
      ctx.globalAlpha = f;
      ctx.strokeStyle = "#ffffff";
      ctx.lineCap = "round";
      for (let i = 0; i < 5; i++) {
        const a = -0.85 + i * 0.42;
        const flick = 0.65 + 0.35 * Math.sin(t * 44 + i * 2.1 + side);
        const len = r * (0.26 + (i % 2) * 0.2) * flick;
        ctx.lineWidth = 2.6 - (i % 2) * 0.9;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex + Math.cos(a) * len * side, ey + Math.sin(a) * len);
        ctx.stroke();
      }

      // Blood out of the ear, running further down the longer it goes on — so the effect builds
      // over the second rather than just flashing and holding.
      const run = (1 - f) * r * 0.55;
      ctx.globalAlpha = Math.min(1, (1 - f) * 3);
      ctx.strokeStyle = "#a3121b";
      ctx.lineWidth = r * 0.09;
      ctx.beginPath();
      ctx.moveTo(ex, ey + r * 0.06);
      ctx.quadraticCurveTo(ex + side * r * 0.05, ey + r * 0.06 + run * 0.6, ex, ey + r * 0.06 + run);
      ctx.stroke();
      ctx.fillStyle = "#c8171f";
      ctx.beginPath();
      ctx.arc(ex, ey + r * 0.06 + run, r * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // Pinned: quicksand. A sink hole opened under the character's feet, turning slowly, with the
  // surface dragging inward and grains circling down into it.
  //
  // Deliberately all AT GROUND LEVEL and nothing above the head — every stun-ish cue in this game
  // (the dizzy spiral, the deafen rings) lives above the head, and a pin is not a daze: the
  // character is still fighting, it just cannot leave the spot.
  drawPinEffect(ctx) {
    if (this.pinnedTimer <= 0) return;
    const r = this.size / 2;
    const y = this.y + r * 0.62;
    const f = Math.min(1, this.pinnedTimer * 4);   // eases out over the last quarter second
    const t = performance.now() / 1000;
    const R = r * 1.05;

    ctx.save();
    ctx.translate(this.x, y);
    ctx.scale(1, 0.44);                            // one squash, so everything below is a circle
    ctx.globalAlpha = f;

    // The pool: wet sand at the rim going almost black down the throat of it
    const pool = ctx.createRadialGradient(0, 0, R * 0.12, 0, 0, R);
    pool.addColorStop(0, "#241a0d");
    pool.addColorStop(0.45, "#6b5433");
    pool.addColorStop(0.82, "#a8874c");
    pool.addColorStop(1, "rgba(168,135,76,0)");
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();

    // Surface dragged into a slow spiral. Three arms, each a spiral arc wound inward.
    ctx.strokeStyle = "rgba(226,198,144,0.5)";
    ctx.lineWidth = r * 0.055;
    ctx.lineCap = "round";
    for (let arm = 0; arm < 3; arm++) {
      const base = t * 1.5 + (arm / 3) * Math.PI * 2;
      ctx.beginPath();
      for (let k = 0; k <= 16; k++) {
        const u = k / 16;
        const rad = R * (0.9 - u * 0.62);
        const ang = base + u * 2.4;
        const px = Math.cos(ang) * rad, py = Math.sin(ang) * rad;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // Grains circling down, each on its own inward spiral so the pool visibly swallows them
    for (let i = 0; i < 10; i++) {
      const phase = (t * 0.75 + i / 10) % 1;       // 0 at the rim, 1 at the throat
      const rad = R * (0.95 - phase * 0.8);
      const ang = t * 2.2 + i * 2.1 + phase * 3.2;
      ctx.globalAlpha = f * (1 - phase) * 0.9;
      ctx.fillStyle = i % 2 ? "#e0c690" : "#c9a86a";
      ctx.beginPath();
      ctx.arc(Math.cos(ang) * rad, Math.sin(ang) * rad, r * (0.055 - phase * 0.03), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = f;

    // A raised lip of thrown-up sand around the outside
    ctx.strokeStyle = "rgba(120,96,54,0.55)";
    ctx.lineWidth = r * 0.11;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.99, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Sand climbing the character's legs, drawn unsquashed so it stands up off the pool
    ctx.save();
    ctx.globalAlpha = f * 0.9;
    ctx.fillStyle = "#8a6d3c";
    for (let i = 0; i < 6; i++) {
      const a = t * 0.9 + (i / 6) * Math.PI * 2;
      const px = this.x + Math.cos(a) * r * 0.66;
      const climb = r * (0.16 + 0.1 * Math.sin(t * 3 + i));
      ctx.beginPath();
      ctx.ellipse(px, y - climb * 0.5, r * 0.11, climb, Math.cos(a) * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
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
    this.drawShieldBand(ctx, barX, barY, barW, 10);

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
    const nm = this.displayName;
    ctx.fillText(this.alive ? nm : nm + L(" (Defeated)", "（已敗）"), x, y);

    const barH = 18;
    const barY = y + 14;
    const ratio = Math.max(0, this.hp / this.maxHp);
    this.drawBar(ctx, x, barY, w, barH, ratio, ratio > 0.5 ? "#50f050" : ratio > 0.3 ? "#ffc832" : "#ff3c3c");
    this.drawShieldBand(ctx, x, barY, w, barH);

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
