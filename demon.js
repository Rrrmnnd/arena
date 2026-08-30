// Demon: ranged trident-thrower. Holds a trident that visibly tracks the opponent; on attack
// it winds up with a short thrust animation and hurls that trident, and a fresh one grows back
// into its hand before the next throw. Since it isn't a homing shot, a moving target can walk
// out of its path, so it lands in the wall behind them and fades.
//
// Every trident that lands sticks in the target, and the third one to stick RIPS ALL THREE OUT
// at once for a burst of damage. It's a passive, driven purely by accuracy — three hits, no
// matter how long they took, and no permanent stat gain, no heal, no speed burst either time.
//
// Ultimate — Recall: every trident that MISSED and is sitting in a wall tears itself free, rises
// into a ring overhead, turns on the opponent, and flies home. So the two halves of the kit pull
// in opposite directions and neither throw is wasted: hits feed the passive, misses arm the
// ultimate — and landing a rip in turn refunds part of the ultimate's own cooldown. Recalled
// tridents steer as they fly (an ordinary throw never does), hit for their own (lower) number,
// and heal half of that back — the ONLY place lifesteal lives in this kit now — and embed on
// contact like any other, which usually means the volley itself sets off the passive.

const DEMON_MAX_HP          = 105;
const DEMON_SPEED           = 280;
const DEMON_ATTACK_COOLDOWN = 1.0;   // seconds between throws
const DEMON_ATTACK_DAMAGE   = 4;     // damage per trident that lands on an ordinary throw
const DEMON_SELF_DAMAGE_PER_THROW = 2;   // HP the Demon pays for every trident it throws — this alone can never kill it
const DEMON_HIT_HP_RETURN         = 2.5; // HP recovered when a thrown trident actually lands (net +0.5 on a hit, -2 on a miss)
const DEMON_TRIDENT_SPEED   = 1300;  // px/sec while in flight — faster flight = smaller dodge window = higher hit chance
const DEMON_KNOCKBACK_STRENGTH = 70;  // px/sec impulse on a base-size (60) target; scales inversely with the target's size
// Missed tridents no longer rot away on a timer — they're the ultimate's ammunition now, so they
// stay in the wall until Recall comes for them. Capped instead of timed: past this many, the
// oldest one fades out, which keeps a long round from papering the arena in tridents.
const DEMON_WALL_TRIDENT_CAP = 10;
const DEMON_MISS_FADE_TIME   = 0.6; // only used for the oldest one being pushed out past the cap

// The passive: three tridents stuck in the target is the trigger, not a meter.
const DEMON_RIP_TRIDENT_COUNT = 3;
const DEMON_RIP_DAMAGE        = 4;    // damage per trident ripped out
// Healed once per rip, not once per trident — the passive always rips DEMON_RIP_TRIDENT_COUNT
// at a time, so per-trident would be three times this every time it fires.
const DEMON_RIP_HEAL          = 3;

// Ultimate — Recall. Holds (rather than firing into nothing) while no trident is stuck in a wall,
// the same way Fire Mage's eruption waits for lava.
const DEMON_ULT_COOLDOWN     = 15.0;
const DEMON_ULT_RIP_REFUND   = 2.0;  // seconds knocked off the cooldown every time the passive fires
const DEMON_ULT_GATHER       = 0.9;  // wall tridents tear free and rise into a ring overhead
const DEMON_ULT_AIM          = 0.35; // the ring hangs, turns on the target, and shivers
const DEMON_ULT_RING_RADIUS  = 116;  // how wide the ring hovers
// High enough to clear the Demon's own body. The trident sprite is ~95px long, so a ring hung
// any closer just piles them across the character and the formation stops reading as a ring.
const DEMON_ULT_RING_HEIGHT  = 178;
const DEMON_ULT_RING_SQUASH  = 0.42; // flattens the ring into an ellipse, so it reads as lying flat
const DEMON_ULT_RING_MARGIN  = 100;  // clearance kept between the ring and the arena wall
const DEMON_ULT_SPEED        = 1050; // px/sec once they launch
const DEMON_ULT_HOMING       = 7.5;  // rad/sec of steering in flight — an ordinary throw has none
const DEMON_ULT_HIT_DAMAGE   = 2;    // damage per RECALLED trident that lands — its own number, not DEMON_ATTACK_DAMAGE
const DEMON_ULT_HEAL_RATIO   = 0.5;  // fraction of that damage paid back as HP, per recalled hit that lands
const DEMON_ULT_STAGGER      = 0.05; // seconds between each trident launching, so it reads as a volley

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
    this.stuckTo = null;   // the pillar this one is lodged in, if any — see updateTridents
    this.stuckOffX = 0;
    this.stuckOffY = 0;
    this.target = null;
    this.offsetAngle = 0; // where around the target's perimeter this one is stuck, once embedded
    this.fadeTimer = 0;
    this.life = 3.0; // safety timeout, in case it somehow never reaches a wall
    // Set while this one is part of a Recall — see Demon.updateRecall
    this.recall = null; // { fromX, fromY, slot, spin, launchAt }
    this.homing = false;
    // The BufferSource of its own woosh loop, for however long IT is flying home during a
    // Recall — see Demon.updateTridents. Only ever set for a recalled (homing) trident; an
    // ordinary throw stays silent here. Per-trident rather than one shared loop (contrast Fire
    // Mage's lava ambience) because a whole volley can be in flight together, and each should
    // sound like its own object moving, not one sound standing in for all of them.
    this.woosh = null;
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
    this.tridents = []; // every trident thrown this round: flying, embedded, or stuck-in-wall

    this.aimAngle = 0;          // direction the held trident (and the next throw) faces
    this.throwWindup = 0;       // >0 during the brief thrust animation before a throw launches
    this.heldTridentScale = 1;  // 0..1 pop-in scale for the trident regrowing in hand after a throw

    this.ultimateCooldown = DEMON_ULT_COOLDOWN;
    this.ultPhase = null;  // null | "gather" | "aim" | "strike" — see updateRecall
    this.ultTimer = 0;


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

  // Tridents sitting in a wall, i.e. Recall's ammunition
  get wallTridents() {
    return this.tridents.filter((t) => t.state === "stuck");
  }


  // The bar is Recall's cooldown, matching what the same slot means for everyone else. The
  // passive's progress is the HUD line underneath instead — see drawHud.
  get ultimateRatio() {
    if (this.ultPhase) return 1;
    return Math.max(0, Math.min(1, 1 - this.ultimateCooldown / DEMON_ULT_COOLDOWN));
  }

  get ultimateBarColor() {
    return "#ff3050";
  }

  onDeath() {
    super.onDeath();
    this.tridents = this.tridents.filter((t) => t.state !== "embedded"); // can't detonate anymore
  }

  update(dt, opponent) {
    super.update(dt, opponent);
    if (!this.alive) { this.updateTridents(dt, opponent); return; }

    if (this.celebratingVictory) {
      this.updateVictoryZoom(dt);
      this.updateTridents(dt, opponent); // lets any leftover tridents keep fading out normally
      return;
    }

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
      this.attackTimer += DEMON_ATTACK_COOLDOWN;
      playSfx("demonThrow", 0.45);
    }

    // Recall. Holds rather than firing while there's nothing stuck in a wall to call back, so a
    // perfectly accurate Demon simply never has it up — which is the trade for the passive
    // already rewarding accuracy.
    if (this.ultimateCooldown > 0) this.ultimateCooldown -= dt;
    if (!this.ultPhase && this.ultimateCooldown <= 0 && this.canAttack &&
        opponent && opponent.alive && this.wallTridents.length > 0) {
      this.beginRecall();
    }
    if (this.ultPhase) this.updateRecall(dt, opponent);

    // Tridents land (and embed) before the passive is checked, so the third hit rips on the same
    // frame it lands rather than a frame later.
    this.updateTridents(dt, opponent);

    // The passive: the third trident to stick tears all three back out.
    if (this.embeddedTridents.length >= DEMON_RIP_TRIDENT_COUNT) this.ripTridents(opponent);
  }

  // ---------------------------------------------------------------- Recall
  //
  // Three beats: the wall tridents tear free and rise into a ring overhead (gather), the ring
  // hangs and turns on the target (aim), then they launch one after another a few frames apart
  // (strike) so it lands as a volley rather than a single wall of spears.

  beginRecall() {
    const wall = this.wallTridents;
    this.ultPhase = "gather";
    this.ultTimer = 0;
    this.ultimateCooldown = DEMON_ULT_COOLDOWN;

    wall.forEach((t, i) => {
      t.recall = {
        fromX: t.x,
        fromY: t.y,
        fromAngle: t.angle,
        slot: (i / wall.length) * Math.PI * 2,
        // Staggered launch, so the volley arrives as a stream instead of all on one frame
        launchAt: i * DEMON_ULT_STAGGER,
      };
      t.state = "recalled";
      spawnImpactParticles(t.x, t.y, ["#ff2020", "#8a0000"], 8, 1.0, 0);
    });

    triggerShake(7, 0.3);
    playSfx("demonUltimate", 0.75);
  }

  // Where the ring hangs. Nominally straight up from the Demon, but clamped so the whole
  // formation stays inside the arena: hung blindly overhead, a Demon fighting near the top wall
  // put the entire ring outside the arena, which read as a pile of tridents stuck to the
  // outside of the wall rather than as its own ultimate winding up.
  //
  // The margin accounts for the sprite as well as the ring itself — a trident is drawn trailing
  // ~95px back from its anchor, so a ring sitting exactly on the boundary still hangs over it.
  get recallRingCentre() {
    const ry = DEMON_ULT_RING_RADIUS * DEMON_ULT_RING_SQUASH;
    const padX = DEMON_ULT_RING_RADIUS + DEMON_ULT_RING_MARGIN;
    const padY = ry + DEMON_ULT_RING_MARGIN;
    return {
      x: Math.min(ARENA.x + ARENA.w - ARENA_BORDER - padX,
         Math.max(ARENA.x + ARENA_BORDER + padX, this.x)),
      y: Math.min(ARENA.y + ARENA.h - ARENA_BORDER - padY,
         Math.max(ARENA.y + ARENA_BORDER + padY, this.y - DEMON_ULT_RING_HEIGHT)),
    };
  }

  // Where a recalled trident hovers in the ring at a given moment. The ring turns slowly, so the
  // formation reads as alive rather than as a frozen decal pinned over the Demon.
  recallSlotPoint(t, spin) {
    const a = t.recall.slot + spin;
    const c = this.recallRingCentre;
    return {
      x: c.x + Math.cos(a) * DEMON_ULT_RING_RADIUS,
      y: c.y + Math.sin(a) * DEMON_ULT_RING_RADIUS * DEMON_ULT_RING_SQUASH,
    };
  }

  updateRecall(dt, opponent) {
    this.ultTimer += dt;
    const spin = this.ultTimer * 2.2;

    if (this.ultPhase === "gather") {
      const f = Math.min(1, this.ultTimer / DEMON_ULT_GATHER);
      const ease = f * f * (3 - 2 * f); // smoothstep, so they pull free rather than snapping across
      for (const t of this.tridents) {
        if (t.state !== "recalled") continue;
        const slot = this.recallSlotPoint(t, spin);
        t.x = t.recall.fromX + (slot.x - t.recall.fromX) * ease;
        t.y = t.recall.fromY + (slot.y - t.recall.fromY) * ease;
        // Spins up as it rises, ending pointing outward along its own slot
        t.angle = t.recall.fromAngle + ease * (Math.PI * 4) + f * 0.001;
      }
      if (this.ultTimer >= DEMON_ULT_GATHER) {
        this.ultPhase = "aim";
        this.ultTimer = 0;
      }
      return;
    }

    if (this.ultPhase === "aim") {
      const shiver = Math.sin(this.ultTimer * 60) * 3;
      for (const t of this.tridents) {
        if (t.state !== "recalled") continue;
        const slot = this.recallSlotPoint(t, spin);
        t.x = slot.x + shiver;
        t.y = slot.y;
        // All of them swing round to point at the target, quivering on the spot
        if (opponent && opponent.alive) t.angle = Math.atan2(opponent.y - t.y, opponent.x - t.x);
      }
      if (this.ultTimer >= DEMON_ULT_AIM) {
        this.ultPhase = "strike";
        this.ultTimer = 0;
      }
      return;
    }

    // strike: each launches on its own beat, then flies as a normal (but steering) trident
    let stillHeld = false;
    for (const t of this.tridents) {
      if (t.state !== "recalled") continue;
      if (this.ultTimer < t.recall.launchAt) {
        stillHeld = true;
        const slot = this.recallSlotPoint(t, spin);
        t.x = slot.x;
        t.y = slot.y;
        if (opponent && opponent.alive) t.angle = Math.atan2(opponent.y - t.y, opponent.x - t.x);
        continue;
      }
      const a = opponent && opponent.alive
        ? Math.atan2(opponent.y - t.y, opponent.x - t.x)
        : t.angle;
      t.angle = a;
      t.vx = Math.cos(a) * DEMON_ULT_SPEED;
      t.vy = Math.sin(a) * DEMON_ULT_SPEED;
      t.state = "flying";
      t.homing = true;      // steers on the way in, unlike an ordinary throw
      t.life = 3.0;
      t.recall = null;
      spawnImpactParticles(t.x, t.y, ["#ff4040", "#ffffff"], 6, 1.2, 0);
      playSfx("demonThrow", 0.35);
    }
    if (!stillHeld) {
      this.ultPhase = null;
      this.ultTimer = 0;
    }
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

    // Every throw costs a little HP, but never enough to kill on its own — clamped to leave 1 HP.
    const selfDmg = Math.min(DEMON_SELF_DAMAGE_PER_THROW, this.hp - 1);
    if (selfDmg > 0) this.takeDamage(selfDmg);
  }

  // Wall tridents are Recall's ammunition and don't expire on their own, so the only thing
  // keeping the arena from silting up is this: past the cap, the oldest still-waiting one starts
  // fading. Ones already caught up in a Recall are left alone.
  enforceWallCap() {
    const waiting = this.tridents.filter((t) => t.state === "stuck" && t.fadeTimer <= 0);
    for (let i = 0; i < waiting.length - DEMON_WALL_TRIDENT_CAP; i++) {
      waiting[i].fadeTimer = DEMON_MISS_FADE_TIME;
    }
  }

  // Stops one trident's own woosh loop, if it has one. Safe to call on a trident that never had
  // one (nothing happens) or one that's already been stopped (t.woosh is already null).
  stopWoosh(t) {
    if (!t.woosh) return;
    try { t.woosh.stop(); } catch (e) {}
    t.woosh = null;
  }

  // Stops every trident's woosh loop unconditionally, mid-flight or not. Only ever needed when
  // this Demon itself is about to be discarded (round reset/re-pick) — see main.js's reset().
  // Without this, any trident still flying at that moment leaves its BufferSource playing with
  // nothing left holding a reference able to stop it, looping forever (the same class of leak
  // stopFiremageLavaLoop exists to prevent for Fire Mage's lava ambience).
  stopAllTridentSounds() {
    for (const t of this.tridents) this.stopWoosh(t);
  }

  updateTridents(dt, opponent) {
    for (let i = this.tridents.length - 1; i >= 0; i--) {
      const t = this.tridents[i];

      if (t.state === "flying") {
        // Recall's tridents only — t.homing is true for exactly those (see updateRecall), false
        // for an ordinary throw. Started the first frame it's seen flying, idempotent (once
        // t.woosh is set it stays set), so this only ever fires once per trident.
        if (t.homing && !t.woosh) t.woosh = playSfx("demonTridentWoosh", 0.5, 0.08, 0, true);

        t.life -= dt;
        // Only recalled tridents steer. A normal throw is committed the moment it leaves the
        // hand — that "a moving target can walk out of the way" is the whole reason misses exist,
        // and misses are what arm Recall in the first place.
        if (t.homing && opponent && opponent.alive) {
          const want = Math.atan2(opponent.y - t.y, opponent.x - t.x);
          let d = want - t.angle;
          d = Math.atan2(Math.sin(d), Math.cos(d)); // shortest way round
          const step = Math.max(-DEMON_ULT_HOMING * dt, Math.min(DEMON_ULT_HOMING * dt, d));
          t.angle += step;
          t.vx = Math.cos(t.angle) * DEMON_ULT_SPEED;
          t.vy = Math.sin(t.angle) * DEMON_ULT_SPEED;
        }
        t.x += t.vx * dt;
        t.y += t.vy * dt;

        if (opponent && opponent.alive) {
          const dist = Math.hypot(opponent.x - t.x, opponent.y - t.y);
          if (dist <= opponent.size / 2 + 6) {
            // A recalled trident hits for its own (lower) number and pays back half of it as
            // HP — Recall's whole payoff, now that the passive it used to share a number with
            // doesn't heal at all. An ordinary throw keeps its old flat regen.
            if (t.homing) {
              opponent.takeDamage(DEMON_ULT_HIT_DAMAGE);
              this.heal(DEMON_ULT_HIT_DAMAGE * DEMON_ULT_HEAL_RATIO);
            } else {
              opponent.takeDamage(DEMON_ATTACK_DAMAGE);
              this.heal(DEMON_HIT_HP_RETURN); // a landed throw pays back more than it cost
            }

            // A slight shove in the direction it was traveling — bigger targets barely budge,
            // smaller ones get bumped a bit more.
            const kb = DEMON_KNOCKBACK_STRENGTH * (CHAR_BASE_SIZE / opponent.size);
            opponent.applyKnockback(Math.cos(t.angle), Math.sin(t.angle), kb);

            t.state = "embedded";
            t.homing = false;
            t.target = opponent;
            t.offsetAngle = Math.random() * Math.PI * 2;
            this.stopWoosh(t);
            playSfx("demonHit", 0.5);
            continue;
          }
        }

        // A pillar catches it the same way a wall does, except the trident stays attached to
        // that particular stone: if the pillar later goes over, the trident it was carrying drops
        // to the floor rather than hanging in mid-air where the rock used to be (see
        // updateTridents' "stuck" branch).
        const pillar = obstacleBlocking(t.x, t.y, 4);
        if (pillar) {
          t.state = "stuck";
          t.homing = false;
          t.stuckTo = pillar;
          t.stuckOffX = t.x - pillar.x;
          t.stuckOffY = t.y - pillar.y;
          t.fadeTimer = 0;
          this.stopWoosh(t);
          spawnImpactParticles(t.x, t.y, ["#9c8a6e", "#6f6047", "#c4b596"], 14, 1.2, 140);
          playSfx("demonHit", 0.35);
          continue;
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
          t.homing = false;
          t.fadeTimer = 0; // 0 means "waiting in the wall indefinitely" — see enforceWallCap
          this.stopWoosh(t);
        }
      } else if (t.state === "stuck" && t.stuckTo) {
        // Riding a pillar. Once that pillar is no longer standing, the trident it was holding
        // falls straight down onto the floor and just lies there like any other spent throw.
        if (t.stuckTo.blocksProjectiles) {
          t.x = t.stuckTo.x + t.stuckOffX;
          t.y = t.stuckTo.y + t.stuckOffY;
        } else {
          t.stuckTo = null;
          t.angle = Math.PI / 2;   // dropped flat on the ground
          spawnImpactParticles(t.x, t.y, ["#9c8a6e", "#6f6047"], 8, 0.9, 200);
        }
      } else if (t.state === "stuck" && t.fadeTimer > 0) {
        // Only ever counting down for one being pushed out past the cap
        t.fadeTimer -= dt;
        if (t.fadeTimer <= 0) this.tridents.splice(i, 1);
      }
      // embedded and recalled tridents live until the passive or Recall clears them
    }
    // Runs after the loop, not before it: a trident that buries itself in the wall THIS frame has
    // to be counted this frame, otherwise the cap sits one over until the next one.
    this.enforceWallCap();
  }

  // Fires the moment DEMON_RIP_TRIDENT_COUNT tridents are stuck in the target — see update().
  // Damage plus a partial heal; no banked stat gain and no speed burst — as a passive it comes
  // around several times a round on its own, and both compounded far too fast on top of that.
  ripTridents(opponent) {
    const stuck = this.embeddedTridents;
    if (opponent && opponent.alive && stuck.length > 0) {
      const dmgPerTrident = DEMON_RIP_DAMAGE;
      for (const t of stuck) {
        opponent.takeDamage(dmgPerTrident);
      }

      this.heal(DEMON_RIP_HEAL);

      // One huge blood burst as every trident rips back out at once, scaled by how many landed.
      spawnImpactParticles(opponent.x, opponent.y, ["#c40000", "#8a0000", "#ff2020", "#500000"], 26 + stuck.length * 10, 2.4, 170);
      spawnFlash(opponent.x, opponent.y, "#ff2020", 100 + stuck.length * 6, 0.5);
      triggerShake(6 + stuck.length * 0.4, 0.3);
      playSfx("demonUltimate", 0.8);
    }
    this.tridents = this.tridents.filter((t) => t.state !== "embedded");

    // Landing hits brings Recall forward. The two halves of the kit feed each other: misses give
    // it ammunition, hits give it back sooner.
    this.ultimateCooldown = Math.max(0, this.ultimateCooldown - DEMON_ULT_RIP_REFUND);
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
        // fadeTimer 0 means it's waiting in the wall indefinitely, not that it's already gone
        const alpha = t.fadeTimer > 0 ? Math.max(0, t.fadeTimer / DEMON_MISS_FADE_TIME) : 1;
        drawTridentShape(ctx, t.x, t.y, t.angle, 1, alpha);
      } else if (t.state === "recalled") {
        drawTridentShape(ctx, t.x, t.y, t.angle, 1, 1);
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

  // No overflow cap left to show, so this is the same pattern every other character uses: the
  // base name+HP-bar+ultimate-bar panel, plus one status line — progress toward the passive,
  // spelled out as an exact count since the bar alone would only round it to a fraction.
  drawHud(ctx, x, y, w) {
    const ny = super.drawHud(ctx, x, y, w);
    if (this.embeddedTridents.length) {
      this.drawHudNote(ctx, x, ny,
        `${this.embeddedTridents.length}/${DEMON_RIP_TRIDENT_COUNT} tridents`, "#ff8a8a");
    }
  }
}
